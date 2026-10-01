import { createFileRoute } from "@tanstack/react-router";
import { handleApiV1 } from "~/server/api/v1/dispatch";

/** The service API (docs/integration.md): every method goes to the registry-driven dispatcher. */
const handler = ({ request }: { request: Request }) => handleApiV1(request);

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: handler,
      PUT: handler,
      DELETE: handler,
      POST: handler,
      PATCH: handler,
    },
  },
});
