/** Image display copies on the local storage driver: width choice, WebP output, stored once. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createLocalStorage, type LocalStorage } from "../src/server/services/storage/local.ts";
import {
  imageVariant,
  isResizable,
  MAX_SOURCE_BYTES,
  variantKey,
  variantWidth,
} from "../src/server/services/storage/variants.ts";

let root: string;
let store: LocalStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sota-variants-"));
  store = createLocalStorage({ root, secret: "test-variants-secret" });
});
afterAll(() => rm(root, { recursive: true, force: true }));

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .png()
    .toBuffer();

describe("variantWidth", () => {
  it("snaps up to a fixed width and caps at the largest", () => {
    expect(variantWidth("800")).toBe(800);
    expect(variantWidth("500")).toBe(800);
    expect(variantWidth("1")).toBe(400);
    expect(variantWidth("99999")).toBe(1600);
  });
  it("ignores what is not a positive number", () => {
    for (const raw of [null, "", "0", "-5", "8e2", "abc", "800px"])
      expect(variantWidth(raw)).toBeNull();
  });
});

describe("isResizable", () => {
  it("covers raster types only", () => {
    expect(isResizable("image/png", 1000)).toBe(true);
    expect(isResizable("image/jpeg", 1000)).toBe(true);
    expect(isResizable("image/svg+xml", 1000)).toBe(false);
    expect(isResizable("image/gif", 1000)).toBe(false);
    expect(isResizable("application/pdf", 1000)).toBe(false);
  });
  it("leaves originals too large to read whole to their signed redirect", () => {
    expect(isResizable("image/png", MAX_SOURCE_BYTES)).toBe(true);
    expect(isResizable("image/png", MAX_SOURCE_BYTES + 1)).toBe(false);
  });
});

describe("imageVariant", () => {
  it("makes a WebP at the width, stores it beside the original and reuses it", async () => {
    const key = "courses/c1/cover.png";
    await store.putObject(key, await png(2400, 1200), "image/png");
    const first = await imageVariant(store, key, 800);
    const meta = await sharp(first!).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([800, 400]);
    expect(await store.headObject(variantKey(key, 800))).toMatchObject({ mime: "image/webp" });

    const put = vi.spyOn(store, "putObject");
    const again = await imageVariant(store, key, 800);
    expect(Buffer.from(again!).equals(Buffer.from(first!))).toBe(true);
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();

    // The original is left as it was.
    expect(await store.headObject(key)).toMatchObject({ mime: "image/png" });
  });

  it("never enlarges a small image", async () => {
    const key = "courses/c1/inline/small.png";
    await store.putObject(key, await png(300, 200), "image/png");
    const meta = await sharp((await imageVariant(store, key, 1200))!).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("is null when the original does not exist", async () => {
    expect(await imageVariant(store, "courses/c1/missing.png", 800)).toBeNull();
  });

  it("refuses what only claims to be a raster image, once", async () => {
    const key = "forum/general/inline/claims-png.png";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>';
    await store.putObject(key, new TextEncoder().encode(svg), "image/png");
    await expect(imageVariant(store, key, 800)).rejects.toThrow(/raster/);
    const get = vi.spyOn(store, "getObject");
    await expect(imageVariant(store, key, 400)).rejects.toThrow();
    // Only the stored-copy lookup: the original is not read and decoded again.
    expect(get.mock.calls.map(([k]) => k)).toEqual([variantKey(key, 400)]);
    get.mockRestore();
  });

  it("refuses a canvas beyond the pixel limit", async () => {
    const key = "courses/c1/inline/huge.png";
    await store.putObject(key, await png(8000, 8000), "image/png");
    await expect(imageVariant(store, key, 400)).rejects.toThrow();
  });

  it("makes one copy for concurrent first views", async () => {
    const key = "courses/c1/inline/busy.png";
    await store.putObject(key, await png(1600, 800), "image/png");
    const put = vi.spyOn(store, "putObject");
    const views = await Promise.all([1, 2, 3].map(() => imageVariant(store, key, 400)));
    expect(put).toHaveBeenCalledTimes(1);
    expect(new Set(views.map((v) => Buffer.from(v!).toString("base64"))).size).toBe(1);
    put.mockRestore();
  });
});
