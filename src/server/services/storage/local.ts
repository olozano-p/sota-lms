/**
 * Local filesystem storage (`STORAGE_DRIVER=local`, the default): objects under
 * `<root>/objects/<key>`, their content type under `<root>/meta/<key>.json`. A "signed URL" is
 * `/api/storage/<token>`, where the token is a base64url JSON payload plus an HMAC over the session
 * secret with an explicit expiry; `handle()` honours it. Uploads stream to disk through Node.
 * Node-native module (relative `.ts` imports): the seed script loads it too. Server-only.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { SIGNED_URL_TTL_S, type StorageProvider } from "./types.ts";
import { errorFields, logger } from "../../../lib/log.ts";

export interface LocalStorageOptions {
  root: string;
  secret: string;
  /** Clock in ms, injectable for tests. */
  now?: () => number;
}

export interface LocalStorage extends StorageProvider {
  /** Serves `/api/storage/$token`: PUT stores the body, GET streams the object. */
  handle(request: Request, token: string): Promise<Response>;
}

interface PutToken {
  op: "put";
  key: string;
  mime: string;
  size: number;
  exp: number;
}
interface GetToken {
  op: "get";
  key: string;
  filename: string;
  mime: string;
  inline: boolean;
  exp: number;
}
type Token = PutToken | GetToken;

/** `/`-separated segments of safe characters, none empty, none starting with a dot (so no `..`). */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const TOKEN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function mediaType(header: string | null): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

/** One `bytes=` range or null; `"unsatisfiable"` when it lies outside the object. */
function parseRange(
  header: string | null,
  size: number,
): [number, number] | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return [start, end];
}

export function createLocalStorage(opts: LocalStorageOptions): LocalStorage {
  const root = resolve(opts.root);
  const now = opts.now ?? (() => Date.now());

  function pathFor(kind: "objects" | "meta", key: string): string {
    if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
    const p = resolve(root, kind, kind === "meta" ? `${key}.json` : key);
    if (!p.startsWith(root + sep)) throw new Error(`invalid storage key: ${key}`);
    return p;
  }

  function sign(encoded: string): string {
    // Domain-separated from the other uses of the session secret (cookies, OIDC transaction).
    return createHmac("sha256", opts.secret).update("storage.").update(encoded).digest("base64url");
  }

  function issue(payload: Token): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `/api/storage/${encoded}.${sign(encoded)}`;
  }

  function verify(raw: string): Token | null {
    const m = TOKEN.exec(raw);
    if (!m) return null;
    const given = Buffer.from(m[2]!);
    const expected = Buffer.from(sign(m[1]!));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let t: Token;
    try {
      t = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as Token;
    } catch {
      return null;
    }
    if ((t.op !== "put" && t.op !== "get") || typeof t.key !== "string" || !KEY.test(t.key))
      return null;
    if (typeof t.exp !== "number" || t.exp * 1000 < now()) return null;
    return t;
  }

  async function writeMeta(key: string, mime: string): Promise<void> {
    const p = pathFor("meta", key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ mime }));
  }

  /** Streams a PUT body to a temp file, refusing anything but exactly `size` bytes. */
  async function receive(t: PutToken, body: NodeReadableStream<Uint8Array>): Promise<Response> {
    const target = pathFor("objects", t.key);
    const tmp = `${target}.${randomUUID()}.part`;
    await mkdir(dirname(target), { recursive: true });
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > t.size) cb(Object.assign(new Error("too large"), { status: 413 }));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body), counter, createWriteStream(tmp));
      if (received !== t.size) return text(400, "body shorter than declared");
      await writeMeta(t.key, t.mime);
      await rename(tmp, target);
      return new Response(null, { status: 204 });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 413) return text(413, "body longer than declared");
      logger.error("storage: upload failed", errorFields(e));
      return text(400, "upload failed");
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async function serve(t: GetToken, request: Request): Promise<Response> {
    const path = pathFor("objects", t.key);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return text(404, "not found");
    }
    const headers = new Headers({
      "content-type": t.mime,
      "content-disposition": `${t.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(t.filename)}`,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // Uploaded SVG or HTML must never run on our origin.
      "content-security-policy": "default-src 'none'; sandbox",
    });
    const range = parseRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const [start, end] = range ?? [0, size - 1];
    headers.set("content-length", String(Math.max(0, end - start + 1)));
    if (range) headers.set("content-range", `bytes ${start}-${end}/${size}`);
    const body =
      size === 0
        ? null
        : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>);
    return new Response(body, { status: range ? 206 : 200, headers });
  }

  /** Content type from the sidecar; the generic type for an object written without one. */
  async function mimeOf(key: string): Promise<string> {
    try {
      return (JSON.parse(await readFile(pathFor("meta", key), "utf8")) as { mime: string }).mime;
    } catch {
      return "application/octet-stream";
    }
  }

  return {
    async signedGetUrl(key, filename, mime, inline = false) {
      pathFor("objects", key);
      const exp = Math.floor(now() / 1000) + SIGNED_URL_TTL_S;
      return issue({ op: "get", key, filename, mime, inline, exp });
    },
    async signedPutUrl(key, mime, size) {
      pathFor("objects", key);
      const exp = Math.floor(now() / 1000) + SIGNED_URL_TTL_S;
      return issue({ op: "put", key, mime, size, exp });
    },
    async headObject(key) {
      try {
        const size = (await stat(pathFor("objects", key))).size;
        return { size, mime: await mimeOf(key) };
      } catch {
        return null;
      }
    },
    async getObject(key) {
      try {
        return { body: await readFile(pathFor("objects", key)), mime: await mimeOf(key) };
      } catch {
        return null;
      }
    },
    async putObject(key, body, mime) {
      const p = pathFor("objects", key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
      await writeMeta(key, mime);
    },
    async handle(request, token) {
      const t = verify(token);
      if (!t) return text(403, "invalid or expired token");
      if (request.method === "PUT") {
        if (t.op !== "put") return text(403, "token does not allow upload");
        const length = request.headers.get("content-length");
        if (length === null) return text(411, "length required");
        if (Number(length) !== t.size) return text(413, "size does not match the signed upload");
        if (mediaType(request.headers.get("content-type")) !== mediaType(t.mime))
          return text(415, "content type does not match the signed upload");
        if (!request.body) return text(400, "empty body");
        return receive(t, request.body as unknown as NodeReadableStream<Uint8Array>);
      }
      if (request.method === "GET") {
        if (t.op !== "get") return text(403, "token does not allow download");
        return serve(t, request);
      }
      return text(405, "method not allowed");
    },
  };
}
