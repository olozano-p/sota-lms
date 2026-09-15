import { createFileRoute } from "@tanstack/react-router";
import { storageRequest } from "~/server/services/storage";

/**
 * Honours the signed URLs the local storage driver mints: PUT stores an upload, GET streams a
 * file. The token is the credential (as a presigned S3 URL would be), issued only after the
 * access checks in the mutations and `/api/files/$fileId`. No session here.
 */
export const Route = createFileRoute("/api/storage/$token")({
  server: {
    handlers: {
      GET: ({ request, params }) => storageRequest(request, params.token),
      PUT: ({ request, params }) => storageRequest(request, params.token),
    },
  },
});
