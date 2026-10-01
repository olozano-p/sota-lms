import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "~/server/auth/auth";

/** better-auth owns everything under /api/auth; its Response (with Set-Cookie) goes out untouched. */
const handle = async ({ request }: { request: Request }) => (await getAuth()).handler(request);

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
