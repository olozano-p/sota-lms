import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/** Browser client for /api/auth/* (same origin). Local mode and break-glass use it; oidc never does. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });

/** Shown in the hint; the server enforces it (MIN_PASSWORD_LENGTH in server/auth/auth.ts). */
export const MIN_PASSWORD_LENGTH = 10;

/** Same-origin paths only, so `?returnTo=` cannot become an open redirect. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/courses";
  if (value.startsWith("/auth/") || value.startsWith("/login")) return "/courses";
  return value;
}
