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
    expect(isResizable("image/png")).toBe(true);
    expect(isResizable("image/jpeg")).toBe(true);
    expect(isResizable("image/svg+xml")).toBe(false);
    expect(isResizable("image/gif")).toBe(false);
    expect(isResizable("application/pdf")).toBe(false);
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
});
