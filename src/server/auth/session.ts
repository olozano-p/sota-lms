import { createServerFn } from "@tanstack/react-start";
import type { Role } from "~/db/schema";
import type { Locale } from "~/i18n/locale";

/** Client-safe shape of the signed-in user. */
export interface SessionUser {
  id: string;
  /** The person's key at the IdP or enrollment source; null for people who exist only locally. */
  sub: string | null;
  name: string;
  email: string;
  roles: Role[];
  locale: Locale | null;
  sessionId: string;
}

/** What the sign-in UI may render; decided by `AUTH_MODE`, never by a flag in a form. */
export interface AuthConfig {
  mode: "local" | "oidc";
  /** Local mode only: the signup form and magic-link signup are open (ALLOW_SIGNUP, or no admin yet). */
  signupOpen: boolean;
  /** OIDC mode with BREAK_GLASS_ADMIN_EMAIL set: `/login/break-glass` exists (it is never linked). */
  breakGlass: boolean;
}

export interface SessionData {
  user: SessionUser | null;
  auth: AuthConfig;
}

/** Called from the root route's `beforeLoad` (which also runs on the client, hence a server fn). */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    const { currentUser } = await import("./authz");
    const { env } = await import("~/config/env");
    const { canSelfRegister } = await import("./identity");
    const user = await currentUser();
    return {
      user,
      auth: {
        mode: env.authMode,
        signupOpen: !user && env.authMode === "local" ? await canSelfRegister() : false,
        breakGlass: env.authMode === "oidc" && env.breakGlassAdminEmail !== null,
      },
    };
  },
);
