/**
 * Per-request security: CSP with a nonce, the usual hardening headers and an in-process rate
 * limiter for `/auth/*` and `/api/*` (a fallback behind the reverse proxy's own limits,
 * docs/deploy.md). Server-only.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { lmsConfig } from "~/config";
import { env } from "~/config/env";
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
 * `frame-src` is built from the enabled video providers and the embed allowlist; storage origins
 * are allowed for media playback and uploads. Styles stay `'unsafe-inline'` (utility classes set
 * inline style attributes); scripts require the nonce.
 */
export function contentSecurityPolicy(nonce: string): string {
  const frames = new Set<string>(["'self'"]);
  for (const p of enabledVideoProviders()) frames.add(`https://${p.embed("0").frameHost}`);
  for (const host of lmsConfig.embedAllowlist) frames.add(`https://${host}`);
  const storage = [origin(process.env.S3_PUBLIC_ENDPOINT), origin(env.s3.endpoint)].filter(
    (o): o is string => !!o,
  );
  const idp = origin(process.env.OIDC_ISSUER);
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://player.vimeo.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
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
  { prefix: "/api/", perMinute: 240 },
];

/** Client address: the first `X-Forwarded-For` hop when `TRUST_PROXY=true`, else the socket peer is unknown → one shared bucket. */
export function clientKey(request: Request): string {
  const trust = process.env.TRUST_PROXY === "true";
  const xff = request.headers.get("x-forwarded-for");
  if (trust && xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "anonymous";
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
