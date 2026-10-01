import { createFileRoute } from "@tanstack/react-router";
import { endSession } from "~/server/auth/flows";

export const Route = createFileRoute("/auth/logout")({
  server: { handlers: { GET: ({ request }) => endSession(request) } },
});
