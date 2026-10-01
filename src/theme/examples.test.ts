import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTheme } from "./load.ts";
import { renderNotification } from "../server/services/email/templates.ts";

const root = join(import.meta.dirname, "..", "..", "examples", "themes");
const vars = (css: string, block: string) =>
  Object.fromEntries(
    [
      ...(new RegExp(`${block}\\{([^}]*)\\}`).exec(css)?.[1] ?? "").matchAll(/(--[\w-]+):([^;]+)/g),
    ].map((m) => [m[1]!, m[2]!.trim()]),
  );

describe("example themes", () => {
  const ledger = loadTheme(join(root, "ledger"), { explicit: true });
  const terminal = loadTheme(join(root, "terminal"), { explicit: true });
  const shipped = loadTheme("/nonexistent");

  it("load without warnings", () => {
    expect(ledger.warnings).toEqual([]);
    expect(terminal.warnings).toEqual([]);
  });

  it("resolve to different variables for every family of token", () => {
    const a = vars(ledger.css, ":root");
    const b = vars(terminal.css, ":root");
    const d = vars(shipped.css, ":root");
    for (const token of [
      "--ink",
      "--paper",
      "--brand-primary",
      "--font-sans",
      "--font-serif",
      "--radius",
      "--radius-surface",
      "--content-width",
      "--measure",
      "--spacing",
    ]) {
      expect(a[token], token).toBeDefined();
      expect(a[token], `ledger vs terminal ${token}`).not.toBe(b[token]);
      expect(a[token], `ledger vs default ${token}`).not.toBe(d[token]);
    }
    expect(vars(ledger.css, "\\.dark")["--paper"]).not.toBe(
      vars(terminal.css, "\\.dark")["--paper"],
    );
    expect(ledger.cssHash).not.toBe(terminal.cssHash);
  });

  it("are loaded from the directory without touching src/", () => {
    expect(ledger.config.name).toBe("The Ledger");
    expect(terminal.config.name).toBe("sota@lab");
  });

  it("each overrides messages and the email layout", () => {
    expect(ledger.messages.en["home.title"]).toBe("Read slowly, in good company.");
    expect(terminal.messages.en["home.title"]).toBe("$ learn --start");
    const payload = { courseTitle: "C", url: "https://x.invalid/l", subject: "S", detail: "D" };
    const a = renderNotification("forum_reply", payload, "en", ledger.config.name, ledger);
    const b = renderNotification("forum_reply", payload, "en", terminal.config.name, terminal);
    expect(a.html).toContain("small-caps");
    expect(b.html).toContain("--notify");
    expect(a.html).toContain("#7a1f2b");
    expect(b.html).toContain("#3dff8b");
    expect(a.html).not.toBe(b.html);
  });

  it("the Header slot fixtures exist when the UI side is in place", () => {
    for (const name of ["ledger", "terminal"])
      expect(() => readFileSync(join(root, name, "slots", "Header.tsx"), "utf8")).not.toThrow();
  });
});
