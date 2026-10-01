/**
 * HTTP side of the theme: `/theme/theme.css` and `/theme/assets/*`. Called from the route
 * handlers only; read-only, public (a theme is not secret), no database.
 */
import { readFile } from "node:fs/promises";
import { assetHeaders, resolveAsset } from "~/theme/assets";
import { getTheme } from "~/theme/runtime";

/** Variables, font faces and `custom.css` (in that order) as one stylesheet. */
export function themeCssResponse(request: Request): Response {
  const theme = getTheme();
  const etag = `"${theme.cssHash}"`;
  const headers = {
    "content-type": "text/css; charset=utf-8",
    // The URL carries `?v=<hash>`, so a changed theme is a new URL; the plain URL revalidates.
    "cache-control": new URL(request.url).searchParams.has("v")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    etag,
    "x-content-type-options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(theme.css, { headers });
}

/** A file from the theme's `assets/`, or 404. `splat` is the part of the URL after `/theme/assets/`. */
export async function themeAssetResponse(request: Request, splat: string): Promise<Response> {
  const asset = resolveAsset(getTheme().assetsDir, splat);
  if (!asset) return new Response("not found", { status: 404 });
  const headers = assetHeaders(asset);
  if (request.headers.get("if-none-match") === headers.etag)
    return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { headers });
  return new Response(new Uint8Array(await readFile(asset.path)), { headers });
}
