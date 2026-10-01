/**
 * The two browser navigations that are not form posts: starting the OIDC redirect and signing out.
 * Routes call these and return the Response as is, so the library's cookies (OIDC state, session
 * deletion) reach the browser. Plain-Node safe.
 */
import { env } from "../../config/env.ts";
import { getAuth, OIDC_PROVIDER_ID } from "./auth.ts";

/** Only same-origin paths are honoured, so a login link cannot become an open redirect. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/auth/"))
    return "/courses";
  return value;
}

function redirect(location: string, from: Response, status: 302 | 303): Response {
  const headers = new Headers({ location });
  for (const cookie of from.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

/** 302 to the IdP's authorization endpoint (code + PKCE + nonce); OIDC mode only. */
export async function beginOidcLogin(request: Request, returnTo: string): Promise<Response> {
  const auth = await getAuth();
  const res = await auth.api.signInSocial({
    headers: request.headers,
    body: {
      provider: OIDC_PROVIDER_ID,
      callbackURL: `${env.appUrl}${safeReturnTo(returnTo)}`,
      errorCallbackURL: `${env.appUrl}/?error=login`,
      disableRedirect: true,
    },
    asResponse: true,
  });
  const body = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url)
    return new Response(null, { status: 303, headers: { location: `${env.appUrl}/?error=login` } });
  return redirect(body.url, res, 302);
}

/** Ends the session; with an IdP that has an end-session endpoint the browser continues there. */
export async function endSession(request: Request): Promise<Response> {
  const auth = await getAuth();
  const res = await auth.api.signOut({
    headers: request.headers,
    body: { callbackURL: `${env.appUrl}/`, disableRedirect: true },
    asResponse: true,
  });
  const body = (await res.json().catch(() => null)) as { url?: string } | null;
  return redirect(body?.url ?? `${env.appUrl}/`, res, 303);
}
