/** Local storage driver on a temp directory: keys, tokens, streamed PUT, ranged GET. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage, type LocalStorage } from "../src/server/services/storage/local.ts";
import { SIGNED_URL_TTL_S } from "../src/server/services/storage/types.ts";

const SECRET = "test-storage-secret";
let clock = new Date("2026-09-15T10:00:00Z").getTime();
let root: string;
let store: LocalStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sota-storage-"));
  store = createLocalStorage({ root, secret: SECRET, now: () => clock });
});
afterAll(() => rm(root, { recursive: true, force: true }));

const tokenOf = (url: string) => url.slice("/api/storage/".length);

function put(url: string, body: string, headers: Record<string, string> = {}) {
  return store.handle(
    new Request(`http://localhost${url}`, {
      method: "PUT",
      body,
      headers: {
        "content-length": String(Buffer.byteLength(body)),
        "content-type": "text/plain",
        ...headers,
      },
    }),
    tokenOf(url),
  );
}

function get(url: string, headers: Record<string, string> = {}) {
  return store.handle(new Request(`http://localhost${url}`, { headers }), tokenOf(url));
}

describe("objects", () => {
  it("round-trips putObject and headObject", async () => {
    await store.putObject("seed/a.txt", "hello", "text/plain");
    expect(await store.headObject("seed/a.txt")).toEqual({ size: 5, mime: "text/plain" });
  });
  it("reads an object back with its content type, and null for a missing one", async () => {
    await store.putObject("seed/b.bin", new Uint8Array([1, 2, 3]), "application/x-test");
    const got = await store.getObject("seed/b.bin");
    expect([...got!.body]).toEqual([1, 2, 3]);
    expect(got!.mime).toBe("application/x-test");
    expect(await store.getObject("seed/none.bin")).toBeNull();
    expect(await store.getObject("../x")).toBeNull();
  });
  it("returns null for a missing object", async () => {
    expect(await store.headObject("seed/missing.txt")).toBeNull();
  });
  it("rejects keys that could leave the root", async () => {
    for (const key of ["../x", "a//b", "/abs", ".hidden", "a/../b", "a/.ssh/id", ""]) {
      expect(await store.headObject(key)).toBeNull();
      await expect(store.signedPutUrl(key, "text/plain", 1)).rejects.toThrow(/invalid storage key/);
      await expect(store.signedGetUrl(key, "x", "text/plain")).rejects.toThrow(
        /invalid storage key/,
      );
    }
  });
});

describe("PUT", () => {
  const key = "courses/c1/0190-notes.txt";
  it("stores exactly the signed body", async () => {
    const url = await store.signedPutUrl(key, "text/plain", 4);
    const r = await put(url, "hola");
    expect(r.status).toBe(204);
    expect(await store.headObject(key)).toEqual({ size: 4, mime: "text/plain" });
    // No temp file left behind.
    expect(
      (await readdir(join(root, "objects/courses/c1"))).filter((f) => f.endsWith(".part")),
    ).toEqual([]);
  });
  it("accepts a content type with parameters", async () => {
    const url = await store.signedPutUrl("courses/c1/params.txt", "text/plain", 4);
    expect((await put(url, "hola", { "content-type": "text/plain; charset=utf-8" })).status).toBe(
      204,
    );
  });
  it("refuses a tampered signature", async () => {
    const url = await store.signedPutUrl(key, "text/plain", 4);
    const last = url.at(-1) === "A" ? "B" : "A";
    expect((await put(url.slice(0, -1) + last, "hola")).status).toBe(403);
  });
  it("refuses an expired token", async () => {
    const url = await store.signedPutUrl(key, "text/plain", 4);
    clock += (SIGNED_URL_TTL_S + 1) * 1000;
    try {
      expect((await put(url, "hola")).status).toBe(403);
    } finally {
      clock -= (SIGNED_URL_TTL_S + 1) * 1000;
    }
  });
  it("refuses a body that does not match the signed size", async () => {
    const url = await store.signedPutUrl("courses/c1/size.txt", "text/plain", 4);
    expect((await put(url, "hola!")).status).toBe(413);
    expect((await put(url, "hola!", { "content-length": "4" })).status).toBe(413);
    expect((await put(url, "hi", { "content-length": "4" })).status).toBe(400);
    expect(await store.headObject("courses/c1/size.txt")).toBeNull();
  });
  it("requires content-length and the signed content type", async () => {
    const url = await store.signedPutUrl("courses/c1/type.txt", "text/plain", 4);
    const stream = new Blob(["hola"]).stream();
    const r = await store.handle(
      new Request(`http://localhost${url}`, {
        method: "PUT",
        body: stream,
        headers: { "content-type": "text/plain" },
        // @ts-expect-error Node's fetch needs this for a streamed body; not in the DOM types.
        duplex: "half",
      }),
      tokenOf(url),
    );
    expect(r.status).toBe(411);
    expect((await put(url, "hola", { "content-type": "image/png" })).status).toBe(415);
  });
  it("does not accept a GET token", async () => {
    const url = await store.signedGetUrl(key, "notes.txt", "text/plain");
    expect((await put(url, "hola")).status).toBe(403);
  });
});

describe("GET", () => {
  const key = "forum/general/0190-hello.txt";
  beforeAll(() => store.putObject(key, "0123456789", "text/plain"));

  it("streams the object with type and disposition", async () => {
    const r = await get(await store.signedGetUrl(key, "hé llo.txt", "text/plain"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain");
    expect(r.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''h%C3%A9%20llo.txt",
    );
    expect(r.headers.get("content-length")).toBe("10");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(await r.text()).toBe("0123456789");
  });
  it("serves inline when asked", async () => {
    const r = await get(await store.signedGetUrl(key, "hello.txt", "text/plain", true));
    expect(r.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''hello.txt");
  });
  it("honours a byte range", async () => {
    const url = await store.signedGetUrl(key, "hello.txt", "text/plain");
    const r = await get(url, { range: "bytes=2-5" });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(r.headers.get("content-length")).toBe("4");
    expect(await r.text()).toBe("2345");
    const tail = await get(url, { range: "bytes=-3" });
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("789");
    const open = await get(url, { range: "bytes=8-" });
    expect(await open.text()).toBe("89");
  });
  it("answers 416 to an unsatisfiable range", async () => {
    const r = await get(await store.signedGetUrl(key, "hello.txt", "text/plain"), {
      range: "bytes=99-",
    });
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */10");
  });
  it("answers 404 for a signed key that was never uploaded", async () => {
    const r = await get(await store.signedGetUrl("forum/general/nope.txt", "n.txt", "text/plain"));
    expect(r.status).toBe(404);
  });
  it("refuses a PUT token, a tampered token and an expired token", async () => {
    const putUrl = await store.signedPutUrl(key, "text/plain", 10);
    expect((await get(putUrl)).status).toBe(403);
    const url = await store.signedGetUrl(key, "hello.txt", "text/plain");
    expect((await get(url.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).status).toBe(403);
    clock += (SIGNED_URL_TTL_S + 1) * 1000;
    try {
      expect((await get(url)).status).toBe(403);
    } finally {
      clock -= (SIGNED_URL_TTL_S + 1) * 1000;
    }
  });
});
