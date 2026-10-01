/**
 * Account writes behind `people.ts` (local mode: invitations and roles). Kept apart from the server
 * functions so that nothing server-only is reachable from the client bundle through a plain export;
 * callers authorise the actor and own the transaction (CLAUDE.md invariants).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "~/db";
import { invitation, person, type Role } from "~/db/schema";
import { env } from "~/config/env";
import { isLocale } from "~/i18n/locale";
import { audit } from "~/server/audit";
import type { SessionUser } from "~/server/auth/authz";
import { hasCredential } from "~/server/auth/identity";
import { issueInvitation } from "~/server/auth/invitations";
import { logger } from "~/lib/log";
import { accountMailThrottled, enqueueAccountMail } from "~/server/services/notifications";

export interface InviteInput {
  email: string;
  name: string;
  roles: Role[];
  locale?: string | null;
}

/**
 * Creates (or re-invites) the person and queues the invitation mail. A person who already has a
 * password cannot be invited again. Callers authorise the actor and own the transaction.
 */
export async function createInvitation(
  tx: DbOrTx,
  actor: Pick<SessionUser, "id" | "name">,
  input: InviteInput,
): Promise<{ personId: string; token: string | null; expiresAt: Date; mailQueued: boolean }> {
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
  // Decide on the mail before touching the invitation: issuing a new token replaces the pending
  // one, and a link nobody was mailed would kill the one the invitee already holds.
  let mailQueued = false;
  let expiresAt: Date;
  let token: string | null = null;
  if (await accountMailThrottled(tx, input.email, "auth_invite")) {
    logger.warn("account mail throttled", { kind: "auth_invite" });
    const [pending] = await tx
      .select({ expiresAt: invitation.expiresAt })
      .from(invitation)
      .where(and(eq(invitation.personId, personId), isNull(invitation.acceptedAt)))
      .limit(1);
    expiresAt = pending?.expiresAt ?? new Date();
  } else {
    const issued = await issueInvitation(tx, personId, actor.id);
    expiresAt = issued.expiresAt;
    token = issued.token;
    mailQueued = await enqueueAccountMail(tx, input.email, "auth_invite", {
      courseTitle: "",
      url: `${env.appUrl}/accept-invite?token=${encodeURIComponent(issued.token)}`,
      detail: actor.name,
      ...(locale ? { locale } : {}),
    });
  }
  await audit(tx, {
    actorId: actor.id,
    action: "person.invite",
    entity: "person",
    entityId: personId,
    after: { email: input.email, roles: input.roles, mailQueued },
  });
  return { personId, token, expiresAt, mailQueued };
}

/**
 * Replaces a person's roles. The last administrator cannot be demoted, so the deployment can
 * never lock itself out of the admin pages.
 */
export async function replaceRoles(
  tx: DbOrTx,
  actorId: string,
  personId: string,
  roles: Role[],
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
