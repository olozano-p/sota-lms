import { createFileRoute } from "@tanstack/react-router";
import { handleEnrollmentWebhook } from "~/server/access/enrollments";

/** Push channel of the enrollments/v1 contract. HMAC-SHA256, 5-minute window, idempotent. */
export const Route = createFileRoute("/api/webhooks/entitlements")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const outcome = await handleEnrollmentWebhook(raw, {
          timestamp: request.headers.get("x-timestamp"),
          signature: request.headers.get("x-signature"),
          eventId: request.headers.get("x-event-id"),
        });
        return Response.json(outcome.body, { status: outcome.status });
      },
    },
  },
});
