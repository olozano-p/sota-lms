import { createFileRoute } from "@tanstack/react-router";
import { env } from "~/config/env";
import { beginOidcLogin, safeReturnTo } from "~/server/auth/flows";

/** The one sign-in address the app links to: the IdP redirect in oidc mode, the form in local mode. */
export const Route = createFileRoute("/auth/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
        if (env.authMode === "oidc") return beginOidcLogin(request, returnTo);
        return new Response(null, {
          status: 302,
          headers: { location: `/login?returnTo=${encodeURIComponent(returnTo)}` },
        });
      },
    },
  },
});
