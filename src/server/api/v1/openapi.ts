/**
 * Builds the OpenAPI 3.1 document from the route registry: parameters, request bodies and
 * responses are the zod schemas the dispatcher validates with, converted by `z.toJSONSchema`.
 */
import { z } from "zod";
import { env } from "~/config/env";
import type { RouteDef } from "./route";
import { authHeaders } from "./schemas";

type Json = Record<string, unknown>;

/** Named schemas (`.meta({ id })`) collected while converting; they become `components.schemas`. */
type Shared = Record<string, Json>;

function schemaOf(schema: z.ZodType, io: "input" | "output", shared: Shared): Json {
  const {
    $schema: _drop,
    $defs,
    ...rest
  } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
    reused: "inline",
  }) as Json & { $defs?: Shared };
  Object.assign(shared, $defs);
  return JSON.parse(JSON.stringify(rest).replaceAll("#/$defs/", "#/components/schemas/"));
}

function parameters(route: RouteDef, shared: Shared): Json[] {
  const out: Json[] = [];
  const params = route.params as z.ZodObject | undefined;
  for (const [name, field] of Object.entries(params?.shape ?? {})) {
    out.push({
      name,
      in: "path",
      required: true,
      description: (field as z.ZodType).description,
      schema: schemaOf(field as z.ZodType, "input", shared),
    });
  }
  if (route.auth === "service") {
    for (const [name, field] of Object.entries(authHeaders.shape)) {
      out.push({
        name,
        in: "header",
        required: false,
        description: (field as z.ZodType).description,
        schema: schemaOf(field as z.ZodType, "input", shared),
      });
    }
  }
  return out;
}

export function buildOpenApi(routes: RouteDef[]): Json {
  const paths: Record<string, Json> = {};
  const shared: Shared = {};
  for (const route of routes) {
    const params = parameters(route, shared);
    paths[route.path] ??= {};
    paths[route.path]![route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      ...(route.description ? { description: route.description } : {}),
      tags: route.tags,
      ...(route.auth === "service" ? { security: [{ serviceToken: [] }] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: schemaOf(route.body, "input", shared) } },
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(route.responses).map(([status, r]) => [
          status,
          {
            description: r.description,
            content: { "application/json": { schema: schemaOf(r.schema, "output", shared) } },
          },
        ]),
      ),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "SOTA service API",
      version: "1.0.0",
      description:
        "Server-to-server API of an external enrollment source. Bearer API_SERVICE_TOKEN; when the server has WEBHOOK_HMAC_SECRET every authenticated call must also be signed (see docs/integration.md).",
    },
    servers: [{ url: `${env.appUrl}/api/v1` }],
    paths,
    components: {
      schemas: JSON.parse(JSON.stringify(shared).replaceAll("#/$defs/", "#/components/schemas/")),
      securitySchemes: {
        serviceToken: { type: "http", scheme: "bearer", description: "API_SERVICE_TOKEN" },
      },
    },
  };
}
