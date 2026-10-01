/**
 * Safe lookup of files under `<THEME_DIR>/assets` for `/theme/assets/*`. A request path is
 * decoded once, split into segments and checked against the same grammar `theme.json` accepts;
 * the resolved real path must stay inside the assets directory (symlinks included) and the
 * extension must be on the allow-list. Plain-Node safe.
 */
import { realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

/** What a theme may ship. SVG is served with a locked-down CSP (see `assetHeaders`). */
export const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/;

export interface ResolvedAsset {
  path: string;
  contentType: string;
  size: number;
  mtimeMs: number;
}

/** The file for a request path such as `fonts/a%20b.woff2`, or null (never throws). */
export function resolveAsset(assetsDir: string, requestPath: string): ResolvedAsset | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((s) => s !== "");
  if (!segments.length || segments.some((s) => s === ".." || !SEGMENT.test(s))) return null;
  const contentType = ASSET_TYPES[extname(segments.at(-1)!).toLowerCase()];
  if (!contentType) return null;
  try {
    const root = realpathSync(assetsDir);
    const real = realpathSync(join(root, ...segments));
    if (!real.startsWith(root + sep)) return null;
    const st = statSync(real);
    if (!st.isFile()) return null;
    return { path: real, contentType, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Headers for an asset response: nosniff always, and a sandbox for SVG so it cannot run script. */
export function assetHeaders(asset: ResolvedAsset): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": asset.contentType,
    "content-length": String(asset.size),
    "cache-control": "public, max-age=3600",
    etag: `"${asset.size.toString(16)}-${Math.floor(asset.mtimeMs).toString(16)}"`,
    "x-content-type-options": "nosniff",
  };
  if (asset.contentType === "image/svg+xml")
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return headers;
}
