/**
 * Serves `/api/v1/*` from the registry: 404 while the API is disabled, route and method matching,
 * authentication, body limit, zod validation, then the handler. The route file is a thin wrapper.
 */
import { z } from "zod";
import { env } from "~/config/env";
import { requireService, ServiceAuthError, type ServiceActor } from "~/server/auth/service";
import { ServiceApiError } from "~/server/mutations/service-enrollments-core";
import { routes } from "./routes";
import type { Method, RouteDef } from "./route";
import { errorFields, logger } from "~/lib/log";

export const API_PREFIX = "/api/v1";
export const MAX_BODY_BYTES = 64 * 1024;

const NO_STORE = { "cache-control": "no-store" };

function problem(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

const compile = (path: string) => new RegExp(`^${path.replace(/\{(\w+)\}/g, "([^/]+)")}$`);
const names = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

const compiled = routes.map((route) => ({
  route,
  re: compile(route.path),
  names: names(route.path),
}));

/** The registered `{method, path}` pairs, for tests and the OpenAPI cross-check. */
export const registeredRoutes = () => routes.map((r) => ({ method: r.method, path: r.path }));

function issues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Reads at most MAX_BODY_BYTES, counting while streaming so a chunked body cannot buffer unbounded. */
async function readBody(request: Request): Promise<string | Response> {
  const tooLarge = () => problem(413, "payload_too_large", "request body too large");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleApiV1(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rel = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, "") || "/";
  const method = request.method.toLowerCase();

  let hit: { route: RouteDef; values: string[]; names: string[] } | null = null;
  let pathKnown = false;
  for (const c of compiled) {
    const m = c.re.exec(rel);
    if (!m) continue;
    pathKnown = true;
    if (c.route.method === method) hit = { route: c.route, values: m.slice(1), names: c.names };
  }
  // Health is the one route that answers while the API is disabled.
  if (!env.api.serviceToken && hit?.route.path !== "/health")
    return problem(404, "not_found", "not found");
  if (!hit) {
    if (!pathKnown) return problem(404, "not_found", "not found");
    const allow = compiled
      .filter((c) => c.re.test(rel))
      .map((c) => c.route.method.toUpperCase())
      .join(", ");
    return problem(405, "method_not_allowed", "method not allowed", {}, { allow });
  }
  const { route } = hit;

  let raw = "";
  if (method !== "get" && method !== "head") {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    raw = body;
  }

  let actor: ServiceActor | null = null;
  if (route.auth === "service") {
    try {
      actor = requireService(request, raw);
    } catch (e) {
      if (e instanceof ServiceAuthError)
        return problem(401, e.code, e.message, {}, { "www-authenticate": 'Bearer realm="sota"' });
      throw e;
    }
  }

  let params: unknown = undefined;
  if (route.params) {
    const decoded = Object.fromEntries(
      hit.names.map((n, i) => {
        try {
          return [n, decodeURIComponent(hit!.values[i]!)];
        } catch {
          return [n, hit!.values[i]!];
        }
      }),
    );
    const parsed = route.params.safeParse(decoded);
    if (!parsed.success)
      return problem(422, "validation_failed", "invalid path parameters", {
        issues: issues(parsed.error),
      });
    params = parsed.data;
  }

  let body: unknown = undefined;
  if (route.body) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return problem(400, "invalid_json", "the body is not valid JSON");
    }
    const parsed = route.body.safeParse(json);
    if (!parsed.success)
      return problem(422, "validation_failed", "the body does not match the schema", {
        issues: issues(parsed.error),
      });
    body = parsed.data;
  }

  try {
    const result = await route.handler({ params, body, request, actor });
    return Response.json(result.body, { status: result.status, headers: NO_STORE });
  } catch (e) {
    if (e instanceof ServiceApiError) return problem(e.status, e.code, e.message);
    logger.error("api/v1 handler failed", { method, route: route.path, ...errorFields(e) });
    return problem(500, "internal_error", "internal error");
  }
}

export type { Method };
