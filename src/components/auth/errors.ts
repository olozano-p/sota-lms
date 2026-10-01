import type { MessageKey } from "~/i18n";

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

/** Maps what the server answered to a catalog key; raw codes are never shown. */
export function authErrorKey(err: AuthErrorLike | null | undefined): MessageKey {
  const raw = `${err?.code ?? ""} ${err?.message ?? ""}`.toLowerCase();
  if (raw.includes("local_login_disabled")) return "auth.error.localDisabled";
  if (raw.includes("signup_disabled")) return "auth.error.signupDisabled";
  if (raw.includes("email_not_verified") || raw.includes("email not verified"))
    return "auth.error.emailNotVerified";
  if (raw.includes("invalid_invitation")) return "auth.error.invalidInvitation";
  if (raw.includes("password_too_short") || raw.includes("too_short"))
    return "auth.error.passwordTooShort";
  if (raw.includes("invalid_token") || raw.includes("token")) return "auth.error.invalidToken";
  if (err?.status === 429) return "auth.error.rateLimited";
  if (raw.includes("invalid_email_or_password") || err?.status === 401)
    return "auth.error.invalidCredentials";
  return "auth.error.generic";
}
