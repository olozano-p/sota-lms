/**
 * Admin invitations: a person row plus a one-time link to set a first password. Only the token's
 * hash is stored. The admin mutation creates them (`mutations/people.ts`); the better-auth plugin
 * in `invite-plugin.ts` redeems them. Plain-Node safe.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/index.ts";
import { invitation, person } from "../../db/schema.ts";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Replaces any pending invitation of the person with a fresh one; returns the token to mail. */
export async function issueInvitation(
  tx: DbOrTx,
  personId: string,
  createdBy: string | null,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  await tx
    .delete(invitation)
    .where(and(eq(invitation.personId, personId), isNull(invitation.acceptedAt)));
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await tx
    .insert(invitation)
    .values({ personId, tokenHash: hashInvitationToken(token), expiresAt, createdBy });
  return { token, expiresAt };
}

/** The pending, unexpired invitation for a token, with the invitee. */
export async function findOpenInvitation(token: string, now = new Date(), tx: DbOrTx = db) {
  const [row] = await tx
    .select({
      id: invitation.id,
      personId: invitation.personId,
      email: person.email,
      name: person.name,
    })
    .from(invitation)
    .innerJoin(person, eq(person.id, invitation.personId))
    .where(
      and(
        eq(invitation.tokenHash, hashInvitationToken(token)),
        isNull(invitation.acceptedAt),
        gt(invitation.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}
