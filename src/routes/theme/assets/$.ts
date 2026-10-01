import { createFileRoute } from "@tanstack/react-router";
import { themeAssetResponse } from "~/server/theme-http";

/** A file from the theme's `assets/` (logo, favicon, fonts). Public, read-only. */
export const Route = createFileRoute("/theme/assets/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => themeAssetResponse(request, params._splat ?? ""),
      // themeAssetResponse omits the body when the method is HEAD.
      HEAD: ({ request, params }) => themeAssetResponse(request, params._splat ?? ""),
    },
  },
});
