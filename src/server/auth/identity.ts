/**
 * Identity rules shared by the sign-in hooks, the admin mutations and the scripts: who is the
 * first user, what an OIDC profile writes onto `person`, and what happens after an OIDC sign-in.
 * Plain-Node safe (relative imports with .ts extensions).
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/index.ts";
import { authAccount, cohortMember, enrollment, person, type Role } from "../../db/schema.ts";
import { env } from "../../config/env.ts";
import { isLocale } from "../../i18n/locale.ts";
import { syncClaimEnrollments } from "../access/claims.ts";
import { audit } from "../audit.ts";
import { syncEnrollments } from "../access/enrollments.ts";
import { mapRoles } from "./roles.ts";
import { errorFields, logger } from "../../lib/log.ts";

/** True while no person holds the admin role: the next sign-up becomes the first admin. */
export async function noAdminYet(tx: DbOrTx = db): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(person)
    .where(sql`'admin' = any(${person.roles})`);
  return (row?.n ?? 0) === 0;
}

export async function hasCredential(personId: string, tx: DbOrTx = db): Promise<boolean> {
  const rows = await tx
    .select({ id: authAccount.id })
    .from(authAccount)
    .where(sql`${authAccount.userId} = ${personId} and ${authAccount.providerId} = 'credential'`)
    .limit(1);
  return rows.length > 0;
}

/** Whether a magic link or password sign-up may create a person right now (local mode). */
export async function canSelfRegister(): Promise<boolean> {
  return env.authMode === "local" && (env.allowSignup || (await noAdminYet()));
}

// ---------- OIDC ----------

/** The verified claims of one sign-in, handed from `getUserInfo` to the after-callback hook. */
export interface OidcProfile {
  sub: string;
  email: string;
  name: string;
  locale: string | null;
  roles: Role[];
  claims: Record<string, unknown>;
}

const pending = new Map<string, { profile: OidcProfile; at: number }>();
const PENDING_TTL_MS = 2 * 60 * 1000;

export function stashOidcProfile(profile: OidcProfile, now = Date.now()): void {
  for (const [k, v] of pending) if (now - v.at > PENDING_TTL_MS) pending.delete(k);
  pending.set(profile.sub, { profile, at: now });
}

export function takeOidcProfile(sub: string, now = Date.now()): OidcProfile | null {
  const entry = pending.get(sub);
  pending.delete(sub);
  return entry && now - entry.at <= PENDING_TTL_MS ? entry.profile : null;
}

/** Normalises ID-token (and userinfo) claims into the profile SOTA mirrors. */
export function profileFromClaims(
  claims: Record<string, unknown>,
  rolesClaim = env.oidc.rolesClaim,
): OidcProfile | null {
  const sub = typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  const email = typeof claims.email === "string" && claims.email ? claims.email : null;
  if (!sub || !email) return null;
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
  return {
    sub,
    email: email.toLowerCase(),
    name,
    locale: typeof claims.locale === "string" ? claims.locale.split("-")[0]!.toLowerCase() : null,
    roles: mapRoles(claims[rolesClaim]),
    claims,
  };
}

/** Writes what the IdP says onto the person: identity key, language, roles, last seen. */
export async function applyOidcIdentity(
  personId: string,
  profile: OidcProfile,
  tx: DbOrTx = db,
): Promise<void> {
  await tx
    .update(person)
    .set({
      externalSub: profile.sub,
      externalIss: env.oidc.issuer,
      locale: isLocale(profile.locale) ? profile.locale : null,
      roles: profile.roles,
      lastSeenAt: new Date(),
    })
    .where(eq(person.id, personId));
}

/**
 * The service API may hold enrollments for a `sub` that never signed in, on a placeholder person
 * (`external_sub` set, no `external_iss`, no account). When that sub signs in under a different
 * email than the placeholder's, better-auth creates a second person; this moves the placeholder's
 * enrollments and cohort places to the signed-in person and deletes the placeholder. Rows of every
 * source move; of two rows in the same course, cohort and source the better one (active, then the
 * later end) is kept and the other is deleted.
 */
export async function adoptSubPlaceholder(
  personId: string,
  sub: string,
  tx: DbOrTx = db,
): Promise<boolean> {
  const placeholders = await tx
    .select({ id: person.id })
    .from(person)
    .where(
      and(
        eq(person.externalSub, sub),
        ne(person.id, personId),
        sql`${person.externalIss} is null`,
        sql`not exists (select 1 from ${authAccount} where ${authAccount.userId} = ${person.id})`,
      ),
    );
  if (!placeholders.length) return false;
  await tx.transaction(async (t) => {
    for (const { id } of placeholders) {
      const rows = await t.select().from(enrollment).where(eq(enrollment.personId, id));
      const mine = await t.select().from(enrollment).where(eq(enrollment.personId, personId));
      const better = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
        (a.status === "active") !== (b.status === "active")
          ? a.status === "active"
          : (a.validUntil?.getTime() ?? Infinity) > (b.validUntil?.getTime() ?? Infinity);
      const bySlot = new Map(mine.map((r) => [`${r.courseId}|${r.cohortId ?? ""}|${r.source}`, r]));
      for (const r of rows) {
        const slot = `${r.courseId}|${r.cohortId ?? ""}|${r.source}`;
        const held = bySlot.get(slot);
        // On a collision the better row (active, then the later end) survives.
        if (held) {
          if (!better(r, held)) continue;
          await t.delete(enrollment).where(eq(enrollment.id, held.id));
        }
        bySlot.set(slot, r);
        await t.update(enrollment).set({ personId }).where(eq(enrollment.id, r.id));
      }
      const places = await t.select().from(cohortMember).where(eq(cohortMember.personId, id));
      if (places.length)
        await t
          .insert(cohortMember)
          .values(places.map((m) => ({ cohortId: m.cohortId, personId, role: m.role })))
          .onConflictDoNothing();
      await t.delete(person).where(eq(person.id, id));
      await audit(t, {
        actorId: null,
        actor: "oidc-login",
        action: "person.adopt_placeholder",
        entity: "person",
        entityId: personId,
        after: { placeholderId: id, sub, enrollmentsMoved: rows.length },
      });
    }
  });
  return true;
}

/**
 * After a verified OIDC sign-in: mirror the identity, reconcile claim enrollments when
 * `ENTITLEMENT_CLAIM` is set and present, refresh from the pull source when configured, and
 * re-apply the IdP's roles last (the pull payload may carry its own). The IdP's roles and identity
 * are authoritative, so their failure propagates; enrollment sync failures are logged, not fatal.
 */
export async function completeOidcLogin(personId: string, profile: OidcProfile): Promise<void> {
  await adoptSubPlaceholder(personId, profile.sub);
  await applyOidcIdentity(personId, profile);
  const claimName = env.oidc.entitlementClaim;
  if (claimName && claimName in profile.claims) {
    try {
      await syncClaimEnrollments(personId, profile.claims[claimName]);
    } catch (e) {
      logger.warn("claims sync failed", errorFields(e));
    }
  }
  if (env.entitlements.pullUrl) {
    try {
      await syncEnrollments(profile.sub);
    } catch (e) {
      logger.warn("enrollment sync on login failed", errorFields(e));
    }
    await db.update(person).set({ roles: profile.roles }).where(eq(person.id, personId));
  }
}
