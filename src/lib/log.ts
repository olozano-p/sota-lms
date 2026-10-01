/**
 * One tiny structured logger: a JSON object per line on stdout (debug, info) or stderr (warn,
 * error), level from `LOG_LEVEL` (`debug | info | warn | error | silent`, default `info`).
 * Nothing sensitive is written: field names that usually carry a secret, a token or an address are
 * replaced, and free text (error messages) is scrubbed of email addresses, bearer tokens and
 * `token=` style query values. Plain-Node safe (no imports): scripts, the production server and
 * the bundle all use it.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
type Emitting = Exclude<LogLevel, "silent">;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** Field names whose value is never logged. */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|signature|credential|api[-_]?key|email|^to$|^url$/i;

const EMAIL = /[^\s@<>"',;:()[\]]+@[^\s@<>"',;:()[\]]+\.[^\s@<>"',;:()[\]]+/g;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const QUERY_SECRET = /\b(token|secret|password|code|signature|key|sig)=([^&\s"']+)/gi;
const LONG_HEX = /\b[a-f0-9]{32,}\b/gi;

/** Removes anything that looks like an address or a credential from free text. */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(BEARER, "$1 [redacted]")
    .replace(QUERY_SECRET, "$1=[redacted]")
    .replace(LONG_HEX, "[redacted]");
}

/** Copies a value for logging with sensitive keys masked and strings scrubbed (bounded depth). */
export function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value.length > 500 ? value.slice(0, 500) : value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return errorFields(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1);
  }
  return out;
}

/** The loggable part of an error: its name and a scrubbed message, never the stack. */
export function errorFields(e: unknown): { error: string; message: string } {
  if (e instanceof Error) return { error: e.name, message: scrubText(e.message).slice(0, 2000) };
  return { error: "NonError", message: scrubText(String(e)).slice(0, 2000) };
}

/**
 * The path of a request without anything that identifies a credential or a person: no query
 * string, and the segments that carry a token, an external id or a subject are replaced.
 */
export function loggablePath(pathname: string): string {
  return pathname
    .replace(/^(\/api\/storage\/)[^/]+/, "$1:token")
    .replace(/^(\/api\/auth\/reset-password\/)[^/]+/, "$1:token")
    .replace(/^(\/api\/v1\/enrollments\/)[^/]+/, "$1:external_id")
    .replace(/^(\/api\/v1\/users\/)[^/]+/, "$1:sub")
    .replace(/^(\/api\/files\/)[^/]+/, "$1:id");
}

export type LogSink = (level: Emitting, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  (level === "warn" || level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
};
let sink: LogSink = defaultSink;

/** Tests capture output through this; pass nothing to restore stdout/stderr. */
export function setLogSink(next?: LogSink): void {
  sink = next ?? defaultSink;
}

export function logLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw ?? "") ? (raw as LogLevel) : "info";
}

export function log(level: Emitting, msg: string, fields: Record<string, unknown> = {}): void {
  if (RANK[level] < RANK[logLevel()]) return;
  const safe = sanitize(fields) as Record<string, unknown>;
  sink(level, JSON.stringify({ time: new Date().toISOString(), level, msg, ...safe }));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
};

/** A request id from an upstream proxy when it is a sane token, else a fresh one. */
export function requestId(incoming: string | null | undefined): string {
  if (incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}
