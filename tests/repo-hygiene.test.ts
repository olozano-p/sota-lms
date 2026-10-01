import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("compose.yml", () => {
  const compose = readFileSync(new URL("../compose.yml", import.meta.url), "utf8");
  it("takes the image from SOTA_IMAGE with a generic placeholder default", () => {
    expect(compose).toMatch(/image:\s*\$\{SOTA_IMAGE:-ghcr\.io\/OWNER\/sota:latest\}/);
  });
});
