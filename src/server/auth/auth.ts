/**
 * The better-auth instance (ADR-013, ADR-016), configured from `AUTH_MODE`:
 *
 * - `local`: email + password, magic link, admin invitations, optional signup, first user = admin.
 * - `oidc`: one generic OIDC client against `OIDC_ISSUER`; local credentials exist only for
 *   `BREAK_GLASS_ADMIN_EMAIL`. The magic-link and invitation endpoints are not registered at all.
 *
 * The user model is `person`. Sessions, accounts and one-time values live in the `auth_*` tables.
 * Plain-Node safe (relative imports with .ts extensions): `scripts/create-admin.ts` uses it too.
 */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "../../db/index.ts";
import { authAccount, authSession, authVerification, person } from "../../db/schema.ts";
import { env } from "../../config/env.ts";
import { enqueueAccountMail, sendImmediate } from "../services/notifications.ts";
import type { AccountMailKind } from "../services/email/templates.ts";
import {
  canSelfRegister,
  completeOidcLogin,
  noAdminYet,
  profileFromClaims,
  stashOidcProfile,
  takeOidcProfile,
} from "./identity.ts";
import { invitePlugin } from "./invite-plugin.ts";
import { CLIENT_IP_HEADER, withClientIp } from "../client-ip.ts";
import { errorFields, logger } from "../../lib/log.ts";

/** Idle lifetime; the absolute 12 h cap is enforced in `currentUser()` (docs/spec.md §8). */
export const SESSION_IDLE_SECONDS = 2 * 60 * 60;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** True once a session is older than the absolute cap, however recently it was used. */
export const pastAbsoluteLimit = (createdAt: Date, now = Date.now()): boolean =>
  createdAt.getTime() + SESSION_ABSOLUTE_MS <= now;
export const OIDC_PROVIDER_ID = "oidc";
export const MIN_PASSWORD_LENGTH = 10;

/** Account mail is queued, then flushed at once so the link arrives in seconds, not at the next tick. */
async function sendAccountMail(
  email: string,
  kind: AccountMailKind,
  url: string,
  extra: { detail?: string } = {},
): Promise<void> {
  await enqueueAccountMail(db, email, kind, { courseTitle: "", url, ...extra });
  sendImmediate().catch((e) => logger.warn("account mail failed", errorFields(e)));
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface Discovery {
  userinfo_endpoint?: string;
}

/** Fetches the discovery document with a short retry, so a slow IdP at boot is not a permanent failure. */
async function discover(): Promise<Discovery> {
  const url = `${env.oidc.issuer}/.well-known/openid-configuration`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return (await res.json()) as Discovery;
      last = new Error(`discovery answered ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`OIDC discovery failed for ${url}: ${(last as Error).message}`);
}

const LOCAL_ONLY_PATHS = [
  "/sign-up/email",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
];

function createAuth(discovery: Discovery | null) {
  const oidc = env.authMode === "oidc";
  const secure = env.appUrl.startsWith("https://");

  const plugins = oidc
    ? [
        genericOAuth({
          config: [
            {
              providerId: OIDC_PROVIDER_ID,
              discoveryUrl: `${env.oidc.issuer}/.well-known/openid-configuration`,
              requireIdTokenVerification: true,
              clientId: env.oidc.clientId,
              clientSecret: env.oidc.clientSecret,
              authentication: "basic",
              scopes: env.oidc.scopes,
              pkce: true,
              overrideUserInfo: true,
              endSessionEndpoint: env.oidc.endSessionUrl ?? undefined,
              postLogoutRedirectURI: "/",
              /**
               * The framework has verified the ID token (signature, issuer, audience, nonce) before
               * this runs. Profile claims the IdP keeps out of the ID token come from userinfo.
               */
              async getUserInfo(tokens) {
                const claims = tokens.idToken ? decodeJwtPayload(tokens.idToken) : {};
                const incomplete =
                  !claims.email || !claims.name || claims[env.oidc.rolesClaim] === undefined;
                if (incomplete && tokens.accessToken && discovery?.userinfo_endpoint) {
                  const res = await fetch(discovery.userinfo_endpoint, {
                    headers: { authorization: `Bearer ${tokens.accessToken}` },
                    signal: AbortSignal.timeout(8000),
                  });
                  if (res.ok) {
                    const info = (await res.json()) as Record<string, unknown>;
                    if (info.sub === claims.sub) {
                      for (const [k, v] of Object.entries(info)) claims[k] ??= v;
                    }
                  }
                }
                const profile = profileFromClaims(claims);
                if (!profile) return null;
                stashOidcProfile(profile);
                return {
                  id: profile.sub,
                  sub: profile.sub,
                  email: profile.email,
                  name: profile.name,
                  emailVerified: claims.email_verified !== false,
                };
              },
            },
          ],
        }),
      ]
    : [
        magicLink({
          expiresIn: 10 * 60,
          storeToken: "hashed",
          async sendMagicLink({ email, url }) {
            // Never reveal whether an address is registered: an unknown address when signup is
            // closed gets the same success response and no mail.
            const [known] = await db
              .select({ id: person.id })
              .from(person)
              .where(eq(person.email, email.toLowerCase()))
              .limit(1);
            if (!known && !(await canSelfRegister())) return;
            await sendAccountMail(email, "auth_magic_link", url);
          },
        }),
        invitePlugin(),
      ];

  const auth = betterAuth({
    appName: "SOTA",
    baseURL: env.appUrl,
    secret: env.sessionSecret,
    trustedOrigins: [env.appUrl],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        person,
        session: authSession,
        account: authAccount,
        verification: authVerification,
      },
    }),
    advanced: {
      cookiePrefix: "sota",
      useSecureCookies: secure,
      // The library's own limiter keys on this header (set in `handler` below); without it every
      // client shares one bucket and a handful of sign-ins lock the instance.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => uuidv7() },
    },
    onAPIError: { errorURL: `${env.appUrl}/?error=login` },
    user: {
      modelName: "person",
      additionalFields: {
        roles: { type: "string[]", required: false, input: false, defaultValue: [] },
        locale: { type: "string", required: false, input: false },
        externalSub: { type: "string", required: false, input: false },
        externalIss: { type: "string", required: false, input: false },
      },
    },
    session: {
      modelName: "session",
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 5 * 60,
    },
    account: {
      accountLinking: {
        enabled: true,
        // The IdP is the authority on who owns an address; a person created earlier by the sync or
        // the webhook (email not yet verified here) is adopted on first sign-in.
        trustedProviders: [OIDC_PROVIDER_ID],
        requireLocalEmailVerified: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: oidc,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      requireEmailVerification: !oidc,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      async sendResetPassword({ user, url }) {
        await sendAccountMail(user.email, "auth_reset_password", url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      async sendVerificationEmail({ user, url }) {
        await sendAccountMail(user.email, "auth_verify_email", url);
      },
    },
    plugins,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!oidc) return;
        // OIDC mode: no local registration or recovery; password sign-in only for the break-glass admin.
        if (ctx.path === "/sign-in/email") {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : "";
          if (!env.breakGlassAdminEmail || email !== env.breakGlassAdminEmail) {
            throw new APIError("FORBIDDEN", {
              code: "LOCAL_LOGIN_DISABLED",
              message: "local_login_disabled",
            });
          }
          return;
        }
        if (LOCAL_ONLY_PATHS.includes(ctx.path)) {
          throw new APIError("FORBIDDEN", {
            code: "LOCAL_LOGIN_DISABLED",
            message: "local_login_disabled",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!oidc || !ctx.path.startsWith("/callback/")) return;
        const created = ctx.context.newSession;
        if (!created) return;
        const accounts = await ctx.context.internalAdapter.findAccounts(created.user.id);
        const link = accounts.find((a) => a.providerId === OIDC_PROVIDER_ID);
        const profile = link ? takeOidcProfile(link.accountId) : null;
        if (!profile) return;
        try {
          await completeOidcLogin(created.user.id, profile);
        } catch (e) {
          // The IdP's identity and roles are authoritative; without them there is no session.
          logger.error("oidc sign-in could not be completed", errorFields(e));
          await ctx.context.internalAdapter.deleteSession(created.session.token);
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "login_failed" });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, ctx) {
            const path = ctx?.path ?? "";
            const selfService = path === "/sign-up/email" || path === "/magic-link/verify";
            if (selfService) {
              if (!(await canSelfRegister())) {
                throw new APIError("FORBIDDEN", {
                  code: "SIGNUP_DISABLED",
                  message: "signup_disabled",
                });
              }
              const first = await noAdminYet();
              return { data: { ...user, roles: first ? ["admin"] : ["student"] } };
            }
            if (path.startsWith("/callback/")) {
              if (!oidc) throw new APIError("FORBIDDEN", { message: "signup_disabled" });
              return { data: { ...user, email: user.email.toLowerCase() } };
            }
            return { data: user };
          },
        },
      },
      session: {
        create: {
          async before(session, ctx) {
            if (oidc && ctx?.path === "/sign-in/email") {
              // Break-glass sign-in is for administrators only.
              const [p] = await db
                .select({ roles: person.roles })
                .from(person)
                .where(eq(person.id, session.userId))
                .limit(1);
              if (!p?.roles.includes("admin")) {
                throw new APIError("FORBIDDEN", {
                  code: "LOCAL_LOGIN_DISABLED",
                  message: "local_login_disabled",
                });
              }
            }
            return { data: session };
          },
          async after(session) {
            await db
              .update(person)
              .set({ lastSeenAt: new Date() })
              .where(eq(person.id, session.userId));
          },
        },
      },
      account: {
        create: {
          // Only the ID token is needed (RP-initiated logout hint); don't keep bearer tokens at rest.
          async before(account) {
            return { data: { ...account, accessToken: null, refreshToken: null } };
          },
        },
        update: {
          async before(account) {
            return {
              data: {
                ...account,
                ...("accessToken" in account ? { accessToken: null } : {}),
                ...("refreshToken" in account ? { refreshToken: null } : {}),
              },
            };
          },
        },
      },
    },
  });
  const handle = auth.handler;
  auth.handler = (request) => handle(withClientIp(request));
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Promise<Auth> | null = null;

/**
 * The shared instance, created on first use (never at import, so `vite build` needs no runtime
 * configuration). A failed creation, such as an unreachable IdP, is retried on the next call.
 */
export function getAuth(): Promise<Auth> {
  instance ??= (async () => {
    const discovery = env.authMode === "oidc" ? await discover() : null;
    return createAuth(discovery);
  })().catch((e) => {
    instance = null;
    throw e;
  });
  return instance;
}

/** For tests that change the environment between cases. */
export function resetAuth(): void {
  instance = null;
}
