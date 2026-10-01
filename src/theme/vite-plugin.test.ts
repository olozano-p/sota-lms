import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sotaTheme } from "./vite-plugin.ts";
import { SLOT_NAMES } from "./schema.ts";

type Hooks = {
  resolveId: (id: string) => Promise<unknown>;
  load: (id: string) => string | null;
};
const hooks = (dir: string, explicit = true) =>
  sotaTheme({ themeDir: dir, explicit }) as unknown as Hooks;

describe("sotaTheme plugin", () => {
  it("without a theme every slot is the shipped default", async () => {
    const p = hooks("/nonexistent", false);
    const id = (await p.resolveId("virtual:sota-theme-slots")) as string;
    const code = p.load(id)!;
    for (const name of SLOT_NAMES)
      expect(code).toContain(
        `import ${name} from "${join(import.meta.dirname, "default", "slots", `${name}.tsx`)}"`,
      );
    expect(code).toContain('"Header":"default"');
  });

  it("a slot file in the theme replaces only that slot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sota-slots-"));
    mkdirSync(join(dir, "slots"));
    writeFileSync(join(dir, "slots", "Header.tsx"), "export default () => null");
    const p = hooks(dir);
    const code = p.load((await p.resolveId("virtual:sota-theme-slots")) as string)!;
    expect(code).toContain(`import Header from "${join(dir, "slots", "Header.tsx")}"`);
    expect(code).toContain(
      `import Footer from "${join(import.meta.dirname, "default", "slots", "Footer.tsx")}"`,
    );
    expect(code).toContain('"Header":"theme"');
    expect(code).toContain('"Footer":"default"');
  });

  it("fails with the readable theme error when theme.json is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "sota-slots-bad-"));
    writeFileSync(join(dir, "theme.json"), '{"name": 3}');
    expect(() => hooks(dir)).toThrow(/Invalid theme/);
  });
});
