/**
 * The OpenAPI document is generated from the route registry the dispatcher serves: every
 * registered route is documented, every documented operation is served, and the schemas in the
 * document are the ones that validate requests.
 */
import { describe, expect, it } from "vitest";

process.env.API_SERVICE_TOKEN = "t".repeat(40);
const { handleApiV1, registeredRoutes } = await import("../src/server/api/v1/dispatch.ts");
const { routes } = await import("../src/server/api/v1/routes.ts");
const { buildOpenApi } = await import("../src/server/api/v1/openapi.ts");

const ORIGIN = "http://localhost:3003";
const doc = buildOpenApi(routes) as any;
const documented = Object.entries(doc.paths as Record<string, Record<string, unknown>>)
  .flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`))
  .sort();
const registered = registeredRoutes()
  .map((r) => `${r.method.toUpperCase()} ${r.path}`)
  .sort();

describe("OpenAPI document", () => {
  it("lists exactly the registered routes", () => {
    expect(documented).toEqual(registered);
    expect(new Set(registered).size).toBe(registered.length);
    expect(documented).toContain("PUT /enrollments/{external_id}");
  });

  it("is served by the API and equals the generated document", async () => {
    const res = await handleApiV1(new Request(`${ORIGIN}/api/v1/openapi.json`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it("is served route by route: each documented operation reaches its handler", async () => {
    for (const entry of documented) {
      const [method, template] = entry.split(" ") as [string, string];
      const path = template.replace(/\{\w+\}/g, "probe");
      const res = await handleApiV1(new Request(`${ORIGIN}/api/v1${path}`, { method }));
      // Never "no such route" (404 not_found) or "wrong method" (405): auth or validation answered.
      const code = (await res.json()).error?.code;
      expect(res.status === 405 || code === "not_found", `${entry} → ${res.status} ${code}`).toBe(
        false,
      );
    }
  });

  it("answers 405 with exactly the methods the document gives for a path", async () => {
    for (const [path, ops] of Object.entries(
      doc.paths as Record<string, Record<string, unknown>>,
    )) {
      const res = await handleApiV1(
        new Request(`${ORIGIN}/api/v1${path.replace(/\{\w+\}/g, "probe")}`, { method: "PATCH" }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")!.split(", ").sort()).toEqual(
        Object.keys(ops)
          .map((m) => m.toUpperCase())
          .sort(),
      );
    }
  });

  it("takes parameters, body and responses from the validating schemas", () => {
    const put = doc.paths["/enrollments/{external_id}"].put;
    expect(put.parameters.find((p: any) => p.name === "external_id")).toMatchObject({
      in: "path",
      required: true,
    });
    expect(put.parameters.map((p: any) => p.name)).toEqual(
      expect.arrayContaining(["X-Timestamp", "X-Signature"]),
    );
    const ref = put.requestBody.content["application/json"].schema.$ref as string;
    expect(ref).toBe("#/components/schemas/PutEnrollmentRequest");
    const body = doc.components.schemas[ref.split("/").pop()!];
    expect(body.required).toEqual(expect.arrayContaining(["user", "course"]));
    expect(body.properties.valid_until.anyOf).toContainEqual({ type: "null" });
    expect(JSON.stringify(doc)).not.toContain("#/$defs");
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)];
    expect(refs.length).toBeGreaterThan(0);
    for (const [, name] of refs) expect(doc.components.schemas[name!]).toBeTruthy();
    expect(Object.keys(put.responses).sort()).toEqual(["200", "201", "401", "404", "409", "422"]);
    expect(put.security).toEqual([{ serviceToken: [] }]);
    expect(doc.paths["/health"].get.security).toBeUndefined();
    expect(doc.components.securitySchemes.serviceToken.scheme).toBe("bearer");
  });
});
