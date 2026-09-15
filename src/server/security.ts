/**
 * Per-request security: CSP with a nonce, the usual hardening headers and an in-process rate
 * limiter for `/auth/*` and `/api/*` (a fallback behind the reverse proxy's own limits,
 * docs/deploy.md). Server-only.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { lmsConfig } from "~/config";
import { env } from "~/config/env";
import { storageOrigins } from "~/server/services/storage";
import { enabledVideoProviders } from "~/server/services/video";

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
  const idp = origin(process.env.OIDC_ISSUER);
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
const LIMITS: { prefix: string; perMinute: number }[] = [
  { prefix: "/auth/", perMinute: 60 },
  // Signed file GET/PUT (local driver): a page of inline images costs a redirect plus a fetch each.
  { prefix: "/api/storage/", perMinute: 600 },
  { prefix: "/api/", perMinute: 240 },
];

/**
 * Client address for the buckets. `X-Forwarded-For` / `X-Real-IP` are honoured only when
 * `TRUST_PROXY=true`, and then the *last* forwarded hop is used: the one the proxy appended, which
 * the client cannot choose. Otherwise the peer address recorded by `scripts/serve.mjs` in
 * `X-SOTA-Remote-Addr` (overwritten on every request, so not forgeable) is used; without it
 * (vite dev) every request shares one bucket.
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const hops = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
    const real = request.headers.get("x-real-ip");
    if (real) return real;
  }
  return request.headers.get("x-sota-remote-addr") || "anonymous";
}

/** Token bucket per client and path prefix. Returns false when the request must be refused (429). */
export function allowRequest(request: Request, pathname: string, now = Date.now()): boolean {
  const limit = LIMITS.find((l) => pathname.startsWith(l.prefix));
  if (!limit) return true;
  const key = `${limit.prefix}|${clientKey(request)}`;
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
