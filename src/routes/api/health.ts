import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "~/db";

/** Liveness + database reachability. No auth: the reverse proxy and Docker healthcheck call it. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.execute(sql`select 1`);
          return Response.json({ status: "ok", db: "ok" });
        } catch (e) {
          return Response.json({ status: "degraded", db: (e as Error).message }, { status: 503 });
        }
      },
    },
  },
});
