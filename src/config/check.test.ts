import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";
import { checkDeployment } from "./check.ts";

const prod = {
  NODE_ENV: "production",
  SESSION_SECRET: "x".repeat(40),
  STORAGE_DIR: "/data",
  APP_URL: "https://lms.example.org",
};

describe("checkDeployment", () => {
  it("summarises the mode, storage and mail", () => {
    const r = checkDeployment(parseEnv({ ...prod, MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp" }));
    expect(r.summary).toEqual(
      expect.arrayContaining([
        "auth mode: local",
        "storage: local (/data)",
        "mail: smtp",
        "public url: https://lms.example.org",
      ]),
    );
    expect(r.warnings).toEqual([]);
  });
  it("warns about settings that work but are wrong for a public deployment", () => {
    const r = checkDeployment(parseEnv({ ...prod, APP_URL: "http://localhost:3003" }));
    expect(r.warnings.join("\n")).toMatch(/console/);
    expect(r.warnings.join("\n")).toMatch(/APP_URL/);
  });
  it("only warns about console mail where it matters", () => {
    const dev = checkDeployment(parseEnv({}));
    expect(dev.warnings).toEqual([]);
  });
});
