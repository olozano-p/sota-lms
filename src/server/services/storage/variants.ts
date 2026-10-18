/**
 * Display copies of stored images: a WebP no wider than one of a few fixed widths, made on first
 * request from the original and kept beside it under `variants/<key>/v<version>-w<width>.webp`. The original
 * object, its `file` row and every download stay untouched; only `/api/files/$fileId?w=` serves
 * these, after the same access check as the original. Node-native module. Server-only.
 */
import type { StorageProvider } from "./types.ts";

/** Widths a page may ask for; any other `w` snaps up to the next one (or the largest). */
export const VARIANT_WIDTHS = [400, 800, 1200, 1600] as const;

/** Raster types sharp re-encodes safely; SVG and GIF (often animated) keep their original. */
const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Bumped when the encoding below changes: new copies are made and browsers drop the old ones. */
export const VARIANT_VERSION = 1;

export function isResizable(mime: string): boolean {
  return RESIZABLE.has(mime);
}

/** The width to serve for a `w` query value, or null when there is none or it is not a number. */
export function variantWidth(raw: string | null): number | null {
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const asked = Number(raw);
  if (asked === 0) return null;
  return VARIANT_WIDTHS.find((w) => w >= asked) ?? VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]!;
}

export function variantKey(key: string, width: number): string {
  return `variants/${key}/v${VARIANT_VERSION}-w${width}.webp`;
}

/**
 * The WebP copy of `key` at `width`: the stored one, else made now and stored. Never enlarges, and
 * applies the EXIF orientation before dropping metadata. Null when the original does not exist.
 */
export async function imageVariant(
  storage: Pick<StorageProvider, "getObject" | "putObject">,
  key: string,
  width: number,
): Promise<Uint8Array | null> {
  const vkey = variantKey(key, width);
  const stored = await storage.getObject(vkey);
  if (stored) return stored.body;
  const original = await storage.getObject(key);
  if (!original) return null;
  const { default: sharp } = await import("sharp");
  const body = await sharp(original.body, { failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
  await storage.putObject(vkey, body, "image/webp");
  return body;
}
