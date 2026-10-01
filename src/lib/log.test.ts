import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  errorFields,
  log,
  loggablePath,
  requestId,
  sanitize,
  scrubText,
  setLogSink,
} from "./log.ts";

const initialLevel = process.env.LOG_LEVEL;
const lines: string[] = [];
const capture = () => setLogSink((_l, line) => lines.push(line));

beforeEach(() => {
  process.env.LOG_LEVEL = "info";
});

afterEach(() => {
  setLogSink();
  lines.length = 0;
  process.env.LOG_LEVEL = initialLevel;
});

describe("log", () => {
  it("writes one JSON object per line with time, level, msg and the fields", () => {
    capture();
    log("info", "request", { method: "GET", status: 200 });
    const row = JSON.parse(lines[0]!);
    expect(row).toMatchObject({ level: "info", msg: "request", method: "GET", status: 200 });
    expect(new Date(row.time).toString()).not.toBe("Invalid Date");
  });
  it("honours LOG_LEVEL and treats an unknown value as info", () => {
    capture();
    log("debug", "hidden");
    process.env.LOG_LEVEL = "warn";
    log("info", "hidden");
    log("warn", "shown");
    process.env.LOG_LEVEL = "nonsense";
    log("info", "shown too");
    process.env.LOG_LEVEL = "silent";
    log("error", "hidden");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["shown", "shown too"]);
  });
  it("never writes secrets, tokens or addresses", () => {
    capture();
    log("error", "failed", {
      password: "hunter2",
      authorization: "Bearer abc.def.ghi",
      sessionToken: "t",
      email: "a@b.example",
      nested: { cookie: "c=1", ok: "kept" },
      err: new Error("could not mail a@b.example with Bearer abc123 at /x?token=zzz&a=1"),
    });
    const text = lines[0]!;
    for (const secret of ["hunter2", "abc.def.ghi", "a@b.example", "abc123", "zzz", "c=1"])
      expect(text).not.toContain(secret);
    expect(text).toContain("kept");
  });
});

describe("scrubbing", () => {
  it("scrubs addresses, bearer values, query secrets and long hex strings", () => {
    expect(scrubText("to bob@example.org")).toBe("to [email]");
    expect(scrubText("Authorization: Bearer xyz")).toContain("Bearer [redacted]");
    expect(scrubText("?token=abc&x=1")).toBe("?token=[redacted]&x=1");
    expect(scrubText("hash " + "a".repeat(40))).toBe("hash [redacted]");
  });
  it("keeps only the name and a scrubbed message of an error", () => {
    expect(errorFields(new TypeError("bad a@b.example"))).toEqual({
      error: "TypeError",
      message: "bad [email]",
    });
    expect(sanitize({ list: [1, 2] })).toEqual({ list: [1, 2] });
  });
  it("drops the query string and masks token-bearing path segments", () => {
    expect(loggablePath("/api/storage/abc123.def")).toBe("/api/storage/:token");
    expect(loggablePath("/api/v1/enrollments/order-77")).toBe("/api/v1/enrollments/:external_id");
    expect(loggablePath("/api/v1/users/sub-1/progress")).toBe("/api/v1/users/:sub/progress");
    expect(loggablePath("/courses/intro")).toBe("/courses/intro");
  });
});

describe("requestId", () => {
  it("keeps a sane upstream id and replaces anything else", () => {
    expect(requestId("abcd1234-ef")).toBe("abcd1234-ef");
    expect(requestId("x y\nz")).not.toBe("x y\nz");
    expect(requestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
