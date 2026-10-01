/**
 * Per-request security: CSP with a nonce, the usual hardening headers and an in-process rate
 * limiter for `/auth/*`, `/api/*` and server functions (a fallback behind the reverse proxy's own limits,
 * docs/deploy.md). Server-only.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { lmsConfig } from "~/config";
import { env } from "~/config/env";
import { storageOrigins } from "~/server/services/storage";
import { enabledVideoProviders } from "~/server/services/video";
import { clientKey } from "./client-ip";

/** The nonce travels from the request middleware to `getRouter()` through this store. */
export const nonceStore = new AsyncLocalStorage<string>();

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

function origin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `frame-src` is built from the enabled video providers and the embed allowlist; with the S3
 * driver its origins are allowed for images, media playback and uploads (`/api/files` redirects
 * there; the local driver is `'self'`). Styles stay `'unsafe-inline'` (utility classes set inline
 * style attributes); scripts require the nonce.
 */
export function contentSecurityPolicy(nonce: string): string {
  const frames = new Set<string>(["'self'"]);
  for (const p of enabledVideoProviders()) frames.add(`https://${p.embed("0").frameHost}`);
  for (const host of lmsConfig.embedAllowlist) frames.add(`https://${host}`);
  const storage = storageOrigins();
  const idp = env.authMode === "oidc" ? origin(env.oidc.issuer) : null;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://player.vimeo.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https: ${storage.join(" ")}`.trim(),
    "font-src 'self' data:",
    `media-src 'self' blob: ${storage.join(" ")}`.trim(),
    `connect-src 'self' ${storage.join(" ")}`.trim(),
    `frame-src ${[...frames].join(" ")}`,
    `form-action 'self'${idp ? ` ${idp}` : ""}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(nonce: string, isProduction: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  // Vite's dev client injects inline scripts without our nonce; the strict policy is production-only.
  if (isProduction) headers["content-security-policy"] = contentSecurityPolicy(nonce);
  if (env.appUrl.startsWith("https://"))
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

// ---------- Rate limiting ----------

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
/** better-auth endpoints (mounted at /api/auth) that check or issue a credential or a mail. */
export const AUTH_SENSITIVE_PREFIXES = [
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/",
  "/api/auth/sign-in/magic-link",
  "/api/auth/magic-link/",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
  "/api/auth/send-verification-email",
  "/api/auth/verify-email",
  "/api/auth/verify-password",
  "/api/auth/change-password",
  "/api/auth/change-email",
  "/api/auth/set-password",
  "/api/auth/delete-user",
  "/api/auth/invite/",
];
const LIMITS: { prefix: string; perMinute: number; group?: string }[] = [
  // Credential, magic-link, recovery and invitation endpoints: guessing and mail-flooding targets.
  ...AUTH_SENSITIVE_PREFIXES.map((prefix) => ({ prefix, perMinute: 10, group: "auth-sensitive" })),
  { prefix: "/api/auth/", perMinute: 120 },
  { prefix: "/auth/", perMinute: 60 },
  // Signed file GET/PUT (local driver): a page of inline images costs a redirect plus a fetch each.
  { prefix: "/api/storage/", perMinute: 600 },
  // Probes (Docker healthcheck, proxy, uptime monitor) must not be starved by browser traffic that
  // shares their key behind a proxy without TRUST_PROXY.
  { prefix: "/api/health", perMinute: 600 },
  { prefix: "/api/v1/health", perMinute: 600 },
  // Service API: one integration's bursts (a bulk back-fill) in one bucket, apart from browser traffic.
  { prefix: "/api/v1/", perMinute: 300 },
  // The signed push channel of the complete-set contract: a handful of calls a minute is normal.
  { prefix: "/api/webhooks/", perMinute: 60 },
  // Server functions (every admin and teacher mutation, among them invitation and bulk enrollment).
  { prefix: "/_serverFn/", perMinute: 600 },
  { prefix: "/api/", perMinute: 240 },
];

/** The limit that applies to a path (the first matching prefix), or null when it is unlimited. */
export function limitFor(pathname: string): { bucket: string; perMinute: number } | null {
  const l = LIMITS.find((x) => pathname.startsWith(x.prefix));
  return l ? { bucket: l.group ?? l.prefix, perMinute: l.perMinute } : null;
}

export { clientKey };

/** Token bucket per client and path prefix. Returns false when the request must be refused (429). */
export function allowRequest(request: Request, pathname: string, now = Date.now()): boolean {
  const limit = limitFor(pathname);
  if (!limit) return true;
  const key = `${limit.bucket}|${clientKey(request)}`;
  const bucket = buckets.get(key) ?? { tokens: limit.perMinute, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / 60_000) * limit.perMinute;
  bucket.tokens = Math.min(limit.perMinute, bucket.tokens + refill);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (now - b.updatedAt > 120_000) buckets.delete(k);
  }
  return true;
}
