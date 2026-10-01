/** Health with database status, latency and version; the access log carries no secrets. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "../src/lib/log.ts";
import pkg from "../package.json" with { type: "json" };

const initialLevel = process.env.LOG_LEVEL;
const { db } = await import("../src/db/index.ts");
const { healthResult } = await import("../src/server/api/v1/routes.ts");
const { startRequestLog } = await import("../src/server/request-log.ts");

afterEach(() => {
  vi.restoreAllMocks();
  setLogSink();
  process.env.LOG_LEVEL = initialLevel;
});

describe("health", () => {
  it("answers 200 with the version and the database round trip", async () => {
    const r = await healthResult();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", db: "ok", version: pkg.version });
    expect(Number.isInteger(r.body.dbLatencyMs)).toBe(true);
  });
  it("answers 503 when the database fails", async () => {
    vi.spyOn(db, "execute").mockRejectedValue(new Error("connection refused"));
    const r = await healthResult();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ status: "degraded", db: "unreachable", version: pkg.version });
  });
  it("answers 503 when the database hangs past the timeout", async () => {
    vi.spyOn(db, "execute").mockReturnValue(new Promise(() => {}) as never);
    const r = await healthResult(50);
    expect(r.status).toBe(503);
    expect(r.body.db).toBe("unreachable");
  });
});

describe("request log", () => {
  it("logs id, method, path, status and duration, and nothing from the query or headers", () => {
    process.env.LOG_LEVEL = "info";
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    const req = new Request("http://x.test/api/storage/secrettoken?token=abc&email=a@b.example", {
      method: "PUT",
      headers: { authorization: "Bearer topsecret", cookie: "sota.session=zzz" },
    });
    const rlog = startRequestLog(req, "/api/storage/secrettoken");
    rlog.done(204);
    const row = JSON.parse(lines[0]!);
    expect(row).toMatchObject({
      msg: "request",
      method: "PUT",
      path: "/api/storage/:token",
      status: 204,
    });
    expect(row.requestId).toBe(rlog.id);
    expect(typeof row.durationMs).toBe("number");
    for (const secret of ["secrettoken", "abc", "a@b.example", "topsecret", "zzz"])
      expect(lines[0]).not.toContain(secret);
  });
  it("keeps health probes out of the info log and reuses a sane upstream request id", () => {
    process.env.LOG_LEVEL = "info";
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    const rlog = startRequestLog(
      new Request("http://x.test/api/health", { headers: { "x-request-id": "proxy-id-12345" } }),
      "/api/health",
    );
    rlog.done(200);
    expect(lines).toEqual([]);
    expect(rlog.id).toBe("proxy-id-12345");
  });
});
