import { createMiddleware, createStart } from "@tanstack/react-start";
import { env } from "~/config/env";
import { allowRequest, newNonce, nonceStore, securityHeaders } from "~/server/security";

/**
 * Every request: rate limit, then run the handler with a fresh CSP nonce, then harden the
 * response. A CSP the handler already set wins (stored files carry a stricter one).
 */
const security = createMiddleware({ type: "request" }).server(
  async ({ next, request, pathname }) => {
    if (!allowRequest(request, pathname)) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "60", "content-type": "text/plain" },
      });
    }
    const nonce = newNonce();
    const result = await nonceStore.run(nonce, () => next());
    for (const [k, v] of Object.entries(securityHeaders(nonce, env.isProduction)))
      if (k !== "content-security-policy" || !result.response.headers.has(k))
        result.response.headers.set(k, v);
    return result;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [security],
}));
