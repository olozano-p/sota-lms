import { createFileRoute } from "@tanstack/react-router";
import { endSession } from "~/server/auth/login";
import { env } from "~/config/env";

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      GET: async () => {
        const next = await endSession();
        return new Response(null, { status: 303, headers: { location: next ?? `${env.appUrl}/` } });
      },
    },
  },
});
