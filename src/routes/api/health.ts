import { createFileRoute } from "@tanstack/react-router";
import { healthResult } from "~/server/api/v1/routes";

/** Liveness + database reachability. No auth: the reverse proxy and Docker healthcheck call it (alias of `/api/v1/health`). */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const r = await healthResult();
        return Response.json(r.body, { status: r.status });
      },
    },
  },
});
