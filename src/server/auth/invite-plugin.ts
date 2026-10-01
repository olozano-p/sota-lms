/**
 * better-auth plugin for admin invitations (local mode only; in OIDC mode it is not registered, so
 * the endpoints do not exist). `GET /invite/preview` tells the invitee whose link it is; `POST
 * /invite/accept` sets the first password, marks the email verified and signs them in.
 */
import { createAuthEndpoint } from "better-auth/api";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "../../db/index.ts";
import { invitation, person } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { findOpenInvitation } from "./invitations.ts";

const invalid = () =>
  new APIError("BAD_REQUEST", { code: "INVALID_INVITATION", message: "invalid_invitation" });

export const invitePlugin = () => ({
  id: "sota-invite" as const,
  endpoints: {
    invitePreview: createAuthEndpoint(
      "/invite/preview",
      { method: "GET", query: z.object({ token: z.string().min(1) }) },
      async (ctx) => {
        const found = await findOpenInvitation(ctx.query.token);
        if (!found) throw invalid();
        return ctx.json({ email: found.email, name: found.name });
      },
    ),
    inviteAccept: createAuthEndpoint(
      "/invite/accept",
      {
        method: "POST",
        body: z.object({
          token: z.string().min(1),
          password: z.string().min(1).max(128),
          name: z.string().trim().min(1).max(200).optional(),
        }),
      },
      async (ctx) => {
        const found = await findOpenInvitation(ctx.body.token);
        if (!found) throw invalid();
        const { minPasswordLength } = ctx.context.password.config;
        if (ctx.body.password.length < minPasswordLength) {
          throw new APIError("BAD_REQUEST", {
            code: "PASSWORD_TOO_SHORT",
            message: "password_too_short",
          });
        }
        const hash = await ctx.context.password.hash(ctx.body.password);
        const userId = found.personId;
        const accounts = await ctx.context.internalAdapter.findAccounts(userId);
        if (accounts.some((a) => a.providerId === "credential")) {
          await ctx.context.internalAdapter.updatePassword(userId, hash);
        } else {
          await ctx.context.internalAdapter.linkAccount({
            userId,
            providerId: "credential",
            accountId: userId,
            password: hash,
          });
        }
        await db.transaction(async (tx) => {
          await tx
            .update(person)
            .set({ emailVerified: true, ...(ctx.body.name ? { name: ctx.body.name } : {}) })
            .where(eq(person.id, userId));
          await tx
            .update(invitation)
            .set({ acceptedAt: new Date() })
            .where(eq(invitation.id, found.id));
          await audit(tx, {
            actorId: userId,
            action: "invitation.accept",
            entity: "person",
            entityId: userId,
          });
        });
        const user = await ctx.context.internalAdapter.findUserById(userId);
        if (!user) throw invalid();
        const session = await ctx.context.internalAdapter.createSession(userId);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      },
    ),
  },
});
