import { createMiddleware, createStart } from "@tanstack/react-start";
import { env } from "~/config/env";
import { startRequestLog } from "~/server/request-log";
import { allowRequest, newNonce, nonceStore, securityHeaders } from "~/server/security";

/**
 * Every request: id and log line (method, path without query, status, duration; no addresses,
 * headers or bodies), rate limit, then the handler with a fresh CSP nonce, then hardened headers.
 * A CSP the handler already set wins (stored files carry a stricter one).
 */
const security = createMiddleware({ type: "request" }).server(
  async ({ next, request, pathname }) => {
    const rlog = startRequestLog(request, pathname);

    if (!allowRequest(request, pathname)) {
      rlog.done(429);
      return new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "60", "content-type": "text/plain", "x-request-id": rlog.id },
      });
    }
    const nonce = newNonce();
    try {
      const result = await nonceStore.run(nonce, () => next());
      for (const [k, v] of Object.entries(securityHeaders(nonce, env.isProduction)))
        if (k !== "content-security-policy" || !result.response.headers.has(k))
          result.response.headers.set(k, v);
      result.response.headers.set("x-request-id", rlog.id);
      rlog.done(result.response.status);
      return result;
    } catch (e) {
      // A thrown Response is the framework's way to redirect or refuse, not a failure.
      if (e instanceof Response) {
        rlog.done(e.status);
        throw e;
      }
      rlog.failed(e);
      throw e;
    }
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [security],
}));
