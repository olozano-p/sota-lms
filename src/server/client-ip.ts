/**
 * The client address used by the rate limiters. Plain-Node safe: it is read by the auth instance
 * (which scripts import) as well as by the request middleware.
 */

/**
 * `X-Forwarded-For` / `X-Real-IP` are honoured only when `TRUST_PROXY=true`, and then the *last*
 * forwarded hop is used: the one the proxy appended, which the client cannot choose. Otherwise the
 * peer address recorded by `scripts/serve.mjs` in `X-SOTA-Remote-Addr` (overwritten on every
 * request, so not forgeable) is used; without it (vite dev) every request shares one bucket.
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

/** The header better-auth's own limiter reads (`advanced.ipAddress.ipAddressHeaders`). */
export const CLIENT_IP_HEADER = "x-sota-client-ip";

/** A copy of the request carrying the trusted client address; a client-sent value is replaced. */
export function withClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set(CLIENT_IP_HEADER, clientKey(request));
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  // Built from fields, not `new Request(request)`: the dev server's Request wrapper is not cloneable that way.
  return new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    signal: request.signal,
    redirect: request.redirect,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}
