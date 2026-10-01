import { createFileRoute } from "@tanstack/react-router";
import { completeLogin } from "~/server/auth/oidc";
import { createSessionFor } from "~/server/auth/login";
import { env } from "~/config/env";

/**
 * OIDC callback: exchange the code, mirror the person, refresh enrollments, open our session.
 * Errors land on the landing page with a generic code; details go to the server log only.
 */
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        // Behind a proxy the request URL may be internal; the IdP redirected to APP_URL.
        const external = new URL(url.pathname + url.search, env.appUrl);
        try {
          const { claims, returnTo } = await completeLogin(external);
          await createSessionFor(claims);
          return new Response(null, {
            status: 303,
            headers: { location: `${env.appUrl}${returnTo}` },
          });
        } catch (e) {
          console.error("oidc callback failed:", (e as Error).message);
          return new Response(null, {
            status: 303,
            headers: { location: `${env.appUrl}/?error=login` },
          });
        }
      },
    },
  },
});
