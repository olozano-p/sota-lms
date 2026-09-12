import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, slugify } from "./slug";

describe("slugify", () => {
  it("folds diacritics and punctuation", () => {
    expect(slugify("Introducció a la meditació")).toBe("introduccio-a-la-meditacio");
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("SOTA · Lliçó 1")).toBe("sota-llico-1");
  });
  it("produces valid slugs", () => {
    for (const s of ["A", "a b c", "---x---", "Ünïcødé"]) {
      expect(slugify(s)).toMatch(SLUG_PATTERN);
    }
  });
});
