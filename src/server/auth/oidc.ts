/**
 * OIDC relying party (docs/spec.md §3.2): authorization code + PKCE against any compliant issuer,
 * discovered from `${OIDC_ISSUER}/.well-known/openid-configuration`. The ID token is verified by
 * openid-client (`iss`, `aud`, `exp`, `nonce`, signature against the issuer's JWKS). Server-only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import * as client from "openid-client";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { env } from "~/config/env";

const TRANSACTION_COOKIE = "sota_oidc";
const TRANSACTION_TTL_S = 10 * 60;

let configuration: Promise<client.Configuration> | null = null;

export function oidcConfiguration(): Promise<client.Configuration> {
  configuration ??= (async () => {
    const issuer = new URL(env.oidc.issuer);
    const insecure = issuer.protocol === "http:";
    const config = await client.discovery(
      issuer,
      env.oidc.clientId,
      undefined,
      client.ClientSecretBasic(env.oidc.clientSecret),
      insecure ? { execute: [client.allowInsecureRequests] } : undefined,
    );
    // ≤ 60 s of clock skew tolerated on `exp`/`iat` (docs/spec.md §8).
    (config as unknown as Record<symbol, number>)[client.clockTolerance] = 60;
    return config;
  })().catch((e) => {
    configuration = null;
    throw e;
  });
  return configuration;
}

export function redirectUri(): string {
  return `${env.appUrl}/auth/callback`;
}

interface Transaction {
  verifier: string;
  state: string;
  nonce: string;
  returnTo: string;
}

function sign(value: string): string {
  return createHmac("sha256", env.sessionSecret).update(value).digest("base64url");
}

function storeTransaction(t: Transaction): void {
  const encoded = Buffer.from(JSON.stringify(t)).toString("base64url");
  setCookie(TRANSACTION_COOKIE, `${encoded}.${sign(encoded)}`, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: TRANSACTION_TTL_S,
  });
}

function readTransaction(): Transaction | null {
  const raw = getCookie(TRANSACTION_COOKIE);
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const encoded = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(encoded));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Transaction;
  } catch {
    return null;
  }
}

function clearTransaction(): void {
  setCookie(TRANSACTION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** Only same-origin paths are honoured, so the callback cannot become an open redirect. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/auth/"))
    return "/courses";
  return value;
}

export async function beginLogin(returnTo: string): Promise<URL> {
  const config = await oidcConfiguration();
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  storeTransaction({ verifier, state, nonce, returnTo: safeReturnTo(returnTo) });
  return client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
}

export interface IdentityClaims {
  sub: string;
  email: string;
  name: string;
  locale: string | null;
  roles: string[];
  idToken: string;
}

/** Completes the code exchange for the current callback URL and returns the verified claims. */
export async function completeLogin(
  currentUrl: URL,
): Promise<{ claims: IdentityClaims; returnTo: string }> {
  const config = await oidcConfiguration();
  const transaction = readTransaction();
  clearTransaction();
  if (!transaction) throw new Error("login transaction missing or expired");
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: transaction.verifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const idClaims = tokens.claims();
  if (!idClaims) throw new Error("no ID token in the response");
  let email = typeof idClaims.email === "string" ? idClaims.email : null;
  let name = typeof idClaims.name === "string" ? idClaims.name : null;
  let locale = typeof idClaims.locale === "string" ? idClaims.locale : null;
  let rolesRaw = idClaims[env.oidc.rolesClaim];
  if ((!email || !name || rolesRaw === undefined) && tokens.access_token) {
    // IdPs that keep profile claims out of the ID token expose them at the userinfo endpoint.
    const info = await client.fetchUserInfo(config, tokens.access_token, idClaims.sub);
    email ??= typeof info.email === "string" ? info.email : null;
    name ??= typeof info.name === "string" ? info.name : null;
    locale ??= typeof info.locale === "string" ? info.locale : null;
    rolesRaw ??= info[env.oidc.rolesClaim];
  }
  if (!email) throw new Error("the IdP returned no email claim");
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.filter((r): r is string => typeof r === "string")
    : [];
  return {
    claims: {
      sub: idClaims.sub,
      email,
      name: name ?? email,
      locale,
      roles,
      idToken: tokens.id_token ?? "",
    },
    returnTo: transaction.returnTo,
  };
}

/** Where to send the browser after clearing our session; null keeps the user signed in at the IdP. */
export function endSessionUrl(idTokenHint: string | null): string | null {
  const base = env.oidc.endSessionUrl;
  if (!base) return null;
  const url = new URL(base);
  if (idTokenHint) url.searchParams.set("id_token_hint", idTokenHint);
  url.searchParams.set("post_logout_redirect_uri", `${env.appUrl}/`);
  return url.toString();
}
