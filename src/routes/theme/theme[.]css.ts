import { createFileRoute } from "@tanstack/react-router";
import { themeCssResponse } from "~/server/theme-http";

/** The deployment's theme stylesheet. Public: it is fetched before anyone signs in. */
export const Route = createFileRoute("/theme/theme.css")({
  server: {
    handlers: {
      GET: ({ request }) => themeCssResponse(request),
      HEAD: ({ request }) => {
        const res = themeCssResponse(request);
        return new Response(null, { status: res.status, headers: res.headers });
      },
    },
  },
});
