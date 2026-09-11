import { createFileRoute } from "@tanstack/react-router";
import { beginLogin } from "~/server/auth/oidc";

export const Route = createFileRoute("/auth/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/courses";
        const url = await beginLogin(returnTo);
        // Not Response.redirect(): its headers are immutable and the framework must append the cookie.
        return new Response(null, { status: 302, headers: { location: url.toString() } });
      },
    },
  },
});
