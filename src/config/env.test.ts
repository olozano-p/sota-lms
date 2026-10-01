import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.ts";

const oidcVars = {
  AUTH_MODE: "oidc",
  OIDC_ISSUER: "https://idp.example.invalid/",
  OIDC_CLIENT_ID: "sota",
  OIDC_CLIENT_SECRET: "secret",
};

describe("parseEnv", () => {
  it("defaults to local mode with signup closed", () => {
    const e = parseEnv({});
    expect(e.authMode).toBe("local");
    expect(e.allowSignup).toBe(false);
    expect(e.appUrl).toBe("http://localhost:3003");
    expect(e.oidc.scopes).toEqual(["openid", "profile", "email"]);
  });

  it("treats empty values as unset and reads flags", () => {
    const e = parseEnv({ ALLOW_SIGNUP: "true", S3_ENDPOINT: "", DEFAULT_LOCALE: "" });
    expect(e.allowSignup).toBe(true);
    expect(e.s3.endpoint).toBeNull();
    expect(e.defaultLocale).toBeNull();
  });

  it("requires the OIDC variables in oidc mode and lists every missing one", () => {
    expect(() => parseEnv({ AUTH_MODE: "oidc" })).toThrow(EnvError);
    try {
      parseEnv({ AUTH_MODE: "oidc" });
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("OIDC_ISSUER is required when AUTH_MODE=oidc");
      expect(message).toContain("OIDC_CLIENT_ID");
      expect(message).toContain("OIDC_CLIENT_SECRET");
    }
  });

  it("normalises the oidc block and ignores ALLOW_SIGNUP", () => {
    const e = parseEnv({
      ...oidcVars,
      ALLOW_SIGNUP: "true",
      OIDC_SCOPES: "openid email groups",
      ENTITLEMENT_CLAIM: "enrollments",
      BREAK_GLASS_ADMIN_EMAIL: "Root@Example.invalid",
    });
    expect(e.oidc.issuer).toBe("https://idp.example.invalid");
    expect(e.oidc.scopes).toEqual(["openid", "email", "groups"]);
    expect(e.oidc.entitlementClaim).toBe("enrollments");
    expect(e.allowSignup).toBe(false);
    expect(e.breakGlassAdminEmail).toBe("root@example.invalid");
  });

  it("rejects a break-glass admin outside oidc mode, bad enums and bad URLs", () => {
    expect(() => parseEnv({ BREAK_GLASS_ADMIN_EMAIL: "a@example.invalid" })).toThrow(/oidc/);
    expect(() => parseEnv({ AUTH_MODE: "saml" })).toThrow(EnvError);
    expect(() => parseEnv({ APP_URL: "not a url" })).toThrow(/APP_URL/);
    expect(() => parseEnv({ DEFAULT_LOCALE: "fr" })).toThrow(/DEFAULT_LOCALE/);
  });

  it("demands production secrets and the s3/smtp blocks when selected", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(() =>
      parseEnv({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(32), STORAGE_DIR: "/data" }),
    ).not.toThrow();
    expect(() => parseEnv({ STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(() => parseEnv({ MAIL_TRANSPORT: "smtp" })).toThrow(/SMTP_HOST/);
  });
});

describe("THEME_DIR", () => {
  it("defaults to ./theme (not explicit) and resolves a given path", () => {
    const d = parseEnv({});
    expect(d.themeDir).toMatch(/\/theme$/);
    expect(d.themeDirExplicit).toBe(false);
    const e = parseEnv({ THEME_DIR: "examples/themes/ledger" });
    expect(e.themeDir).toMatch(/examples\/themes\/ledger$/);
    expect(e.themeDirExplicit).toBe(true);
    expect(parseEnv({ THEME_DIR: "" }).themeDirExplicit).toBe(false);
  });
});

describe("service API and webhook secret", () => {
  it("leaves the API disabled without a token and rejects a short one", () => {
    const e = parseEnv({});
    expect(e.api.serviceToken).toBeNull();
    expect(e.api.hmacSecret).toBeNull();
    expect(parseEnv({ API_SERVICE_TOKEN: "" }).api.serviceToken).toBeNull();
    expect(() => parseEnv({ API_SERVICE_TOKEN: "short" })).toThrow(/API_SERVICE_TOKEN/);
    expect(parseEnv({ API_SERVICE_TOKEN: "x".repeat(32) }).api.serviceToken).toHaveLength(32);
  });

  it("uses WEBHOOK_HMAC_SECRET for both channels and keeps the old name as a deprecated alias", () => {
    const old = parseEnv({ ENTITLEMENTS_WEBHOOK_SECRET: "old-secret" });
    expect(old.api.hmacSecret).toBe("old-secret");
    expect(old.entitlements.webhookSecret).toBe("old-secret");
    expect(old.deprecated).toHaveLength(1);
    const both = parseEnv({
      ENTITLEMENTS_WEBHOOK_SECRET: "old-secret",
      WEBHOOK_HMAC_SECRET: "new-secret",
    });
    expect(both.api.hmacSecret).toBe("new-secret");
    expect(both.entitlements.webhookSecret).toBe("new-secret");
    expect(both.deprecated).toEqual([]);
  });
});
