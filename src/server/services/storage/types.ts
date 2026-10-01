/**
 * What the app needs from private file storage: two signed, short-lived URLs a browser can use
 * without a session, and two server-side calls around them. Keys are opaque, `/`-separated paths
 * chosen by the mutations (`courses/<id>/…`, `submissions/…`, `forum/…`, `seed/…`).
 */
export const SIGNED_URL_TTL_S = 5 * 60;

export interface StorageProvider {
  /** URL a browser may GET for ≤ 5 min; it must send the given content type and disposition. */
  signedGetUrl(key: string, filename: string, mime: string, inline?: boolean): Promise<string>;
  /** URL a browser may PUT to for ≤ 5 min; the body must be exactly `size` bytes of `mime`. */
  signedPutUrl(key: string, mime: string, size: number): Promise<string>;
  /** After a browser PUT, the server confirms the object exists and reads its real size/type. */
  headObject(key: string): Promise<{ size: number; mime: string } | null>;
  /** Server-side write (seed data, content import). */
  putObject(key: string, body: Uint8Array | string, mime: string): Promise<void>;
  /** Server-side read of a whole object (content export); null when it does not exist. */
  getObject(key: string): Promise<{ body: Uint8Array; mime: string } | null>;
}
