/**
 * Private file storage behind signed URLs (≤ 5 min). `STORAGE_DRIVER` picks the backend: `local`
 * (a directory, the default) or `s3` (any S3 API). Node-native module: the seed script imports
 * `putObject` from here. Server-only.
 */
import { env } from "../../../config/env.ts";
import { createLocalStorage, type LocalStorage } from "./local.ts";
import type { StorageProvider } from "./types.ts";

export { SIGNED_URL_TTL_S, type StorageProvider } from "./types.ts";

let local: LocalStorage | null = null;
let s3: Promise<StorageProvider> | null = null;

function localStorage(): LocalStorage {
  local ??= createLocalStorage({ root: env.storage.dir, secret: env.sessionSecret });
  return local;
}

/** The AWS SDK is loaded only when the S3 driver is selected. */
function storage(): Promise<StorageProvider> {
  if (env.storage.driver === "s3") {
    s3 ??= import("./s3.ts").then((m) => m.createS3Storage());
    return s3;
  }
  return Promise.resolve(localStorage());
}

export const signedGetUrl: StorageProvider["signedGetUrl"] = async (...args) =>
  (await storage()).signedGetUrl(...args);
export const signedPutUrl: StorageProvider["signedPutUrl"] = async (...args) =>
  (await storage()).signedPutUrl(...args);
export const headObject: StorageProvider["headObject"] = async (...args) =>
  (await storage()).headObject(...args);
export const getObject: StorageProvider["getObject"] = async (...args) =>
  (await storage()).getObject(...args);
export const putObject: StorageProvider["putObject"] = async (...args) =>
  (await storage()).putObject(...args);

/** `/api/storage/$token`: only the local driver answers here; with S3 the browser never comes. */
export async function storageRequest(request: Request, token: string): Promise<Response> {
  if (env.storage.driver !== "local") return new Response("not found", { status: 404 });
  return localStorage().handle(request, token);
}

/** Origins the CSP must allow for images, media and uploads besides `'self'`. */
export function storageOrigins(): string[] {
  if (env.storage.driver !== "s3") return [];
  const origins = new Set<string>();
  for (const u of [env.s3.publicEndpoint, env.s3.endpoint]) {
    if (!u) continue;
    try {
      origins.add(new URL(u).origin);
    } catch {
      // Not a URL; nothing to allow.
    }
  }
  return [...origins];
}
