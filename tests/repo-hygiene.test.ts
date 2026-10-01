import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("compose.yml", () => {
  const compose = readFileSync(new URL("../compose.yml", import.meta.url), "utf8");
  it("takes the image from SOTA_IMAGE with a generic placeholder default", () => {
    expect(compose).toMatch(/image:\s*\$\{SOTA_IMAGE:-ghcr\.io\/OWNER\/sota:latest\}/);
  });
});

describe("plain-Node modules", () => {
  // Vitest transpiles everything; Node's native type stripping is stricter (no enums, no parameter
  // properties, explicit .ts extensions). Loading the modules the CLI and the image run proves it.
  const modules = [
    "src/lib/log.ts",
    "src/lib/content-bundle.ts",
    "src/server/audit.ts",
    "src/server/services/content-bundle-dir.ts",
    "src/server/queries/content-export-core.ts",
    "src/server/mutations/content-import-core.ts",
    "scripts/content.ts",
  ];
  it("load under node without a bundler", () => {
    const root = new URL("..", import.meta.url).pathname;
    const code = modules.map((m) => `await import(${JSON.stringify(`${root}${m}`)});`).join("\n");
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: "pglite://memory", NODE_OPTIONS: "" },
      stdio: "pipe",
    });
  });
});
