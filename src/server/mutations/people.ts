/**
 * Admin management of local accounts: invitations and roles. Local mode only: with an IdP the
 * people and their roles come from the IdP (ADR-013). Every function authorises first and ends
 * with an `audit_log` row; the invitation mail is queued (never sent inline) and flushed after
 * the transaction commits.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import { invitation, person, ROLES } from "~/db/schema";
import { env } from "~/config/env";
import { isLocale } from "~/i18n/locale";
import { audit } from "~/server/audit";
import { requireRole, type SessionUser } from "~/server/auth/authz";
import { hasCredential } from "~/server/auth/identity";
import { issueInvitation } from "~/server/auth/invitations";
import { enqueueAccountMail, sendImmediate } from "~/server/services/notifications";

const rolesSchema = z.array(z.enum(ROLES)).min(1);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(200),
  roles: rolesSchema.default(["student"]),
  locale: z.string().nullable().optional(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

function requireLocalMode(): void {
  if (env.authMode !== "local")
    throw new Error("local accounts are managed by the identity provider");
}

/**
 * Creates (or re-invites) the person and queues the invitation mail. A person who already has a
 * password cannot be invited again. Callers authorise the actor and own the transaction.
 */
export async function createInvitation(
  tx: DbOrTx,
  actor: Pick<SessionUser, "id" | "name">,
  input: InviteInput,
): Promise<{ personId: string; token: string; expiresAt: Date }> {
  const [existing] = await tx
    .select({ id: person.id })
    .from(person)
    .where(eq(person.email, input.email))
    .limit(1);
  if (existing && (await hasCredential(existing.id, tx))) {
    throw new Error("this person already has an account");
  }
  const locale = isLocale(input.locale) ? input.locale : null;
  let personId = existing?.id;
  if (personId) {
    await tx
      .update(person)
      .set({ name: input.name, roles: input.roles, ...(locale ? { locale } : {}) })
      .where(eq(person.id, personId));
  } else {
    const [created] = await tx
      .insert(person)
      .values({ email: input.email, name: input.name, roles: input.roles, locale })
      .returning({ id: person.id });
    personId = created!.id;
  }
  const { token, expiresAt } = await issueInvitation(tx, personId, actor.id);
  await enqueueAccountMail(tx, input.email, "auth_invite", {
    courseTitle: "",
    url: `${env.appUrl}/accept-invite?token=${encodeURIComponent(token)}`,
    detail: actor.name,
    ...(locale ? { locale } : {}),
  });
  await audit(tx, {
    actorId: actor.id,
    action: "person.invite",
    entity: "person",
    entityId: personId,
    after: { email: input.email, roles: input.roles },
  });
  return { personId, token, expiresAt };
}

export const invitePerson = createServerFn({ method: "POST" })
  .validator(inviteSchema)
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    requireLocalMode();
    const result = await db.transaction((tx) => createInvitation(tx, admin, data));
    sendImmediate().catch((e) => console.warn("invitation mail failed:", (e as Error).message));
    return { personId: result.personId, expiresAt: result.expiresAt.toISOString() };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .validator(z.object({ invitationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    requireLocalMode();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(invitation)
        .where(and(eq(invitation.id, data.invitationId), isNull(invitation.acceptedAt)))
        .returning();
      if (!row) throw new Error("invitation not found");
      await audit(tx, {
        actorId: admin.id,
        action: "person.invite_revoke",
        entity: "person",
        entityId: row.personId,
      });
    });
    return { ok: true };
  });

/**
 * Replaces a person's roles. The last administrator cannot be demoted, so the deployment can
 * never lock itself out of the admin pages.
 */
export async function replaceRoles(
  tx: DbOrTx,
  actorId: string,
  personId: string,
  roles: (typeof ROLES)[number][],
): Promise<void> {
  const [before] = await tx.select().from(person).where(eq(person.id, personId)).limit(1);
  if (!before) throw new Error("person not found");
  if (before.roles.includes("admin") && !roles.includes("admin")) {
    const [others] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(person)
      .where(sql`'admin' = any(${person.roles}) and ${person.id} <> ${personId}`);
    if (!others?.n) throw new Error("the last administrator cannot be demoted");
  }
  await tx.update(person).set({ roles }).where(eq(person.id, personId));
  await audit(tx, {
    actorId,
    action: "person.set_roles",
    entity: "person",
    entityId: personId,
    before: { roles: before.roles },
    after: { roles },
  });
}

export const setPersonRoles = createServerFn({ method: "POST" })
  .validator(z.object({ personId: z.string().uuid(), roles: rolesSchema }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    requireLocalMode();
    await db.transaction((tx) => replaceRoles(tx, admin.id, data.personId, data.roles));
    return { ok: true };
  });
