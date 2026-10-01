/** Rate-limiter client key: forwarded headers count only behind a trusted proxy, and then the last hop. */
import { afterEach, describe, expect, it } from "vitest";
import { allowRequest, clientKey } from "../src/server/security.ts";
import { withClientIp } from "../src/server/client-ip.ts";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/auth/login", { headers });
}

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe("clientKey", () => {
  it("ignores X-Forwarded-For and X-Real-IP unless TRUST_PROXY=true", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe(
      "anonymous",
    );
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1", "x-sota-remote-addr": "10.0.0.7" }))).toBe(
      "10.0.0.7",
    );
  });
  it("uses the hop the proxy appended (the last one), not the client-supplied first hop", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientKey(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(req({ "x-sota-remote-addr": "127.0.0.1" }))).toBe("127.0.0.1");
  });
});

describe("allowRequest", () => {
  it("refuses the 61st /auth request of a minute from one peer and keeps other peers unaffected", () => {
    const t0 = Date.now();
    const a = req({ "x-sota-remote-addr": "10.1.1.1" });
    const b = req({ "x-sota-remote-addr": "10.1.1.2" });
    for (let i = 0; i < 60; i++) expect(allowRequest(a, "/auth/login", t0)).toBe(true);
    expect(allowRequest(a, "/auth/login", t0)).toBe(false);
    expect(allowRequest(b, "/auth/login", t0)).toBe(true);
    expect(allowRequest(a, "/auth/login", t0 + 60_000)).toBe(true);
  });
  it("allows 10 credential or mail requests a minute across the auth endpoints, then refuses", () => {
    const t0 = Date.now();
    const a = req({ "x-sota-remote-addr": "10.2.2.1" });
    const paths = [
      "/api/auth/sign-in/email",
      "/api/auth/sign-in/magic-link",
      "/api/auth/invite/accept",
    ];
    for (let i = 0; i < 10; i++) expect(allowRequest(a, paths[i % 3]!, t0)).toBe(true);
    expect(allowRequest(a, "/api/auth/sign-in/email", t0)).toBe(false);
    expect(allowRequest(a, "/api/auth/request-password-reset", t0)).toBe(false);
    expect(allowRequest(a, "/api/auth/get-session", t0)).toBe(true);
  });
});

describe("withClientIp", () => {
  it("stamps the trusted address and replaces one sent by the client", () => {
    const r = withClientIp(
      new Request("http://x.test/api/auth/sign-in/email", {
        method: "POST",
        headers: { "x-sota-remote-addr": "10.0.0.7", "x-sota-client-ip": "6.6.6.6" },
        body: "{}",
      }),
    );
    expect(r.headers.get("x-sota-client-ip")).toBe("10.0.0.7");
    expect(r.method).toBe("POST");
  });
});
