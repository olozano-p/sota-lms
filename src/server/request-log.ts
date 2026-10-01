/**
 * The access log: one JSON line per request with an id, method, path (no query string, token
 * segments masked), status and duration. No addresses, headers, cookies or bodies. Server-only.
 */
import { errorFields, log, loggablePath, requestId } from "~/lib/log";

/** Health probes run every few seconds; they are logged at debug so they do not drown the rest. */
const isProbe = (pathname: string) => pathname === "/api/health" || pathname === "/api/v1/health";

export function startRequestLog(request: Request, pathname: string) {
  const started = performance.now();
  const id = requestId(request.headers.get("x-request-id"));
  const base = () => ({
    requestId: id,
    method: request.method,
    path: loggablePath(pathname),
    durationMs: Math.round(performance.now() - started),
  });
  return {
    id,
    done: (status: number) =>
      log(isProbe(pathname) ? "debug" : "info", "request", { ...base(), status }),
    failed: (e: unknown) => log("error", "request failed", { ...base(), ...errorFields(e) }),
  };
}
