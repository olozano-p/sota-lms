import { describe, expect, it } from "vitest";
import { defineConfig } from "./schema.ts";

const base = {
  locales: { enabled: ["ca" as const] },
  uploads: { maxBytes: 1, allowedMime: ["text/plain"] },
  notifications: {},
};

describe("defineConfig", () => {
  it("accepts the non-visual config", () => {
    expect(defineConfig(base).locales.cookieName).toBe("sota_locale");
  });
  it("points at the theme for the keys that moved", () => {
    expect(() => defineConfig({ ...base, brand: { name: "X" } } as never)).toThrow(
      /brand.*theme\.json/,
    );
    expect(() => defineConfig({ ...base, contactEmail: "a@b.c" } as never)).toThrow(/supportEmail/);
    expect(() =>
      defineConfig({ ...base, locales: { enabled: ["ca"], default: "ca" } } as never),
    ).toThrow(/defaultLocale/);
  });
});
