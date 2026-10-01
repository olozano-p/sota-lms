import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "./env.ts";
import { resetThemeCache } from "../theme/runtime.ts";
import { defaultLocale } from "./default-locale.ts";

const use = (themeJson: object, defaultLocaleEnv = "") => {
  const dir = mkdtempSync(join(tmpdir(), "sota-dl-"));
  writeFileSync(join(dir, "theme.json"), JSON.stringify(themeJson));
  process.env.THEME_DIR = dir;
  process.env.DEFAULT_LOCALE = defaultLocaleEnv;
  resetEnvCache();
  resetThemeCache();
};
afterEach(() => {
  delete process.env.THEME_DIR;
  delete process.env.DEFAULT_LOCALE;
  resetEnvCache();
  resetThemeCache();
});

describe("defaultLocale", () => {
  it("is the theme's defaultLocale", () => {
    use({ defaultLocale: "es" });
    expect(defaultLocale()).toBe("es");
  });
  it("lets DEFAULT_LOCALE win", () => {
    use({ defaultLocale: "es" }, "en");
    expect(defaultLocale()).toBe("en");
  });
});
