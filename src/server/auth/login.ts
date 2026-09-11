/**
 * Session lifecycle around the OIDC flow. Together with `access/entitlements.ts` this is the only
 * writer of `person` rows. Server-only.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { person, session } from "~/db/schema";
import { isLocale } from "~/i18n/locale";
import { syncEntitlements } from "~/server/access/entitlements";
import { SESSION_ABSOLUTE_MS, clearSessionCookie, currentUser, setSessionCookie } from "./authz";
import { endSessionUrl, type IdentityClaims } from "./oidc";

export async function createSessionFor(claims: IdentityClaims): Promise<void> {
  const now = new Date();
  const [p] = await db
    .insert(person)
    .values({
      idpSub: claims.sub,
      email: claims.email,
      name: claims.name,
      locale: isLocale(claims.locale) ? claims.locale : null,
      roles: claims.roles,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: person.idpSub,
      set: {
        email: claims.email,
        name: claims.name,
        locale: isLocale(claims.locale) ? claims.locale : null,
        roles: claims.roles,
        lastSeenAt: now,
      },
    })
    .returning({ id: person.id, roles: person.roles });

  // Refresh on login (docs/spec.md §7). The source may also carry roles; the IdP's win here
  // because they were just verified, so re-apply them after the sync.
  try {
    await syncEntitlements(claims.sub);
    await db.update(person).set({ roles: claims.roles }).where(eq(person.id, p!.id));
  } catch (e) {
    console.warn(`entitlement sync on login failed for ${claims.sub}: ${(e as Error).message}`);
  }

  const [s] = await db
    .insert(session)
    .values({
      personId: p!.id,
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      idTokenHint: claims.idToken || null,
      roles: claims.roles,
    })
    .returning({ id: session.id });
  setSessionCookie(s!.id);
}

/** Clears our session; returns the IdP end-session URL to redirect to, when configured. */
export async function endSession(): Promise<string | null> {
  const user = await currentUser();
  let hint: string | null = null;
  if (user) {
    const rows = await db
      .select({ hint: session.idTokenHint })
      .from(session)
      .where(eq(session.id, user.sessionId))
      .limit(1);
    hint = rows[0]?.hint ?? null;
    await db.delete(session).where(eq(session.id, user.sessionId));
  }
  clearSessionCookie();
  return endSessionUrl(hint);
}
