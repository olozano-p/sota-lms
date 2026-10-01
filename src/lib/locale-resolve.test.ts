import { describe, expect, it } from "vitest";
import { resolveLocale } from "./locale-resolve.ts";

type L = "ca" | "es" | "en";
const isEnabled = (v: unknown): v is L => v === "ca" || v === "es" || v === "en";
const base = { isEnabled, fallback: "ca" as L };

describe("resolveLocale", () => {
  it("prefers ?lang, then the cookie, then the profile, then Accept-Language, then the default", () => {
    const all = { lang: "en", cookie: "es", profile: "ca", acceptLanguage: "es-ES,en;q=0.8" };
    expect(resolveLocale({ ...base, ...all })).toBe("en");
    expect(resolveLocale({ ...base, ...all, lang: "xx" })).toBe("es");
    expect(resolveLocale({ ...base, ...all, lang: null, cookie: "xx" })).toBe("ca");
    expect(resolveLocale({ ...base, ...all, lang: null, cookie: null, profile: null })).toBe("es");
    expect(resolveLocale({ ...base, acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("ca");
  });
  it("walks Accept-Language in order until a supported tag", () => {
    expect(resolveLocale({ ...base, fallback: "es", acceptLanguage: "fr,en-GB;q=0.8" })).toBe("en");
  });
});
