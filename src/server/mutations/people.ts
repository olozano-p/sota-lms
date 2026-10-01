/**
 * Admin management of local accounts: invitations and roles. Local mode only: with an IdP the
 * people and their roles come from the IdP (ADR-013). Every function authorises first and ends
 * with an `audit_log` row; the invitation mail is queued (never sent inline) and flushed after
 * the transaction commits.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { invitation, ROLES } from "~/db/schema";
import { env } from "~/config/env";
import { audit } from "~/server/audit";
import { requireRole } from "~/server/auth/authz";
import { sendImmediate } from "~/server/services/notifications";
import { createInvitation, replaceRoles } from "./people-core";

const rolesSchema = z.array(z.enum(ROLES)).min(1);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(200),
  roles: rolesSchema.default(["student"]),
  locale: z.string().nullable().optional(),
});
function requireLocalMode(): void {
  if (env.authMode !== "local")
    throw new Error("local accounts are managed by the identity provider");
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

export const setPersonRoles = createServerFn({ method: "POST" })
  .validator(z.object({ personId: z.string().uuid(), roles: rolesSchema }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    requireLocalMode();
    await db.transaction((tx) => replaceRoles(tx, admin.id, data.personId, data.roles));
    return { ok: true };
  });
