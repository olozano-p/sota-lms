/**
 * Authentication of the service API (`/api/v1`, docs/integration.md): the one non-person actor.
 * `requireService()` is to the API what `requireUser()` is to a server function; mutations that
 * accept a `ServiceActor` can only be reached with the proof it returns. Server-only.
 *
 * Two checks, in this order: the bearer `API_SERVICE_TOKEN` (compared in constant time), then, when
 * `WEBHOOK_HMAC_SECRET` is set, `X-Signature` = hex HMAC-SHA256 over
 * `"{X-Timestamp}.{METHOD}.{path}.{raw body}"` with `X-Timestamp` (unix seconds) within 5 minutes.
 * Binding method and path keeps a captured signature from being replayed against another resource.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "~/config/env";

export const SIGNATURE_MAX_SKEW_S = 5 * 60;

declare const serviceBrand: unique symbol;
/** Proof that the request carried the service token (and a valid signature when one is required). */
export interface ServiceActor {
  readonly kind: "service";
  readonly [serviceBrand]: true;
}

export class ServiceAuthError extends Error {
  constructor(
    public readonly code: "unauthorized" | "invalid_signature" | "stale_timestamp",
    message: string,
  ) {
    super(message);
  }
}

/** Constant-time string comparison: both sides are hashed so the lengths never leak. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function signServiceRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`)
    .digest("hex");
}

export interface ServiceAuthConfig {
  token: string | null;
  hmacSecret: string | null;
  now?: Date;
}

/** Throws `ServiceAuthError` (HTTP 401) unless the request is the service's. */
export function requireService(
  request: Request,
  rawBody: string,
  config: ServiceAuthConfig = { token: env.api.serviceToken, hmacSecret: env.api.hmacSecret },
): ServiceActor {
  if (!config.token) throw new ServiceAuthError("unauthorized", "the API is not enabled");
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match || !safeEqual(match[1]!, config.token))
    throw new ServiceAuthError("unauthorized", "missing or wrong bearer token");

  if (config.hmacSecret) {
    const timestamp = request.headers.get("x-timestamp");
    const given = (request.headers.get("x-signature") ?? "").replace(/^sha256=/i, "");
    if (!timestamp || !given)
      throw new ServiceAuthError("invalid_signature", "missing X-Timestamp or X-Signature");
    const ts = Number(timestamp);
    const now = (config.now ?? new Date()).getTime() / 1000;
    if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_MAX_SKEW_S)
      throw new ServiceAuthError("stale_timestamp", "timestamp outside the allowed window");
    const path = new URL(request.url).pathname;
    const expected = signServiceRequest(
      config.hmacSecret,
      timestamp,
      request.method,
      path,
      rawBody,
    );
    if (!safeEqual(given, expected))
      throw new ServiceAuthError("invalid_signature", "invalid signature");
  }
  return { kind: "service" } as ServiceActor;
}
