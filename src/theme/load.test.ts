import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ca } from "../i18n/ca.ts";
import { ThemeError, deepMerge, flattenMessages, loadTheme, publicTheme } from "./load.ts";
import { resolveAsset } from "./assets.ts";

const roots: string[] = [];
function theme(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "sota-theme-"));
  roots.push(dir);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}
afterAll(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

const problemsOf = (dir: string): string[] => {
  try {
    loadTheme(dir);
  } catch (e) {
    if (e instanceof ThemeError) return e.problems;
    throw e;
  }
  return [];
};

describe("loadTheme: defaults and partial themes", () => {
  it("a missing directory means the shipped defaults", () => {
    const t = loadTheme("/nonexistent/theme-dir");
    expect(t.exists).toBe(false);
    expect(t.config.name).toBe("SOTA");
    expect(t.config.colors.light.primary).toBe("#e0a51c");
    expect(t.css).toContain("--brand-primary:#e0a51c");
    expect(t.css).toContain(".dark{");
  });

  it("an explicit THEME_DIR that does not exist is an error", () => {
    expect(() => loadTheme("/nonexistent/theme-dir", { explicit: true })).toThrow(/does not exist/);
  });

  it("a partial theme.json overrides only what it names", () => {
    const t = loadTheme(
      theme({
        "theme.json": JSON.stringify({ name: "Acme", colors: { light: { primary: "#112233" } } }),
      }),
    );
    expect(t.config.name).toBe("Acme");
    expect(t.config.colors.light.primary).toBe("#112233");
    expect(t.config.colors.light.ink).toBe("#1e1c19");
    expect(t.config.colors.dark.primary).toBe("#f0c455");
    expect(t.config.radius.control).toBe("0.25rem");
  });

  it("a directory with only custom.css is a valid theme and the CSS comes last", () => {
    const t = loadTheme(theme({ "custom.css": "body{outline:1px solid red}" }));
    expect(t.css.endsWith("body{outline:1px solid red}\n")).toBe(true);
    expect(t.css.indexOf(":root{")).toBeLessThan(t.css.indexOf("body{outline"));
    expect(t.css.indexOf(".dark{")).toBeLessThan(t.css.indexOf("body{outline"));
  });

  it("resolves every token through a variable", () => {
    const t = loadTheme(
      theme({
        "theme.json": JSON.stringify({
          fonts: { sans: "'Inter', sans-serif" },
          radius: { control: "0", surface: "1rem" },
          spacing: { unit: "0.3rem", contentWidth: "60rem", proseWidth: "60ch" },
          colors: { light: { card: "#fafafa" } },
        }),
      }),
    );
    for (const v of [
      "--font-sans:'Inter', sans-serif",
      "--radius:0",
      "--radius-surface:1rem",
      "--spacing:0.3rem",
      "--content-width:60rem",
      "--measure:60ch",
      "--card:#fafafa",
    ])
      expect(t.variablesCss).toContain(v);
  });
});

describe("loadTheme: invalid input fails readably", () => {
  it("reports unknown keys, bad colours and bad lengths with their paths", () => {
    const p = problemsOf(
      theme({
        "theme.json": JSON.stringify({
          nme: "typo",
          colors: { light: { primary: "red; } body { display:none" } },
          radius: { control: "big" },
        }),
      }),
    );
    expect(p.join("\n")).toMatch(/theme\.json: \(root\): unknown key "nme"/);
    expect(p.join("\n")).toMatch(/theme\.json: colors\.light\.primary: expected a hex/);
    expect(p.join("\n")).toMatch(/theme\.json: radius\.control: expected a CSS length/);
  });

  it("rejects values that could leave a CSS declaration", () => {
    for (const fonts of [{ sans: "a; } x{" }, { sans: "a{b}" }, { sans: "url(x)" }])
      expect(problemsOf(theme({ "theme.json": JSON.stringify({ fonts }) })).length).toBeGreaterThan(
        0,
      );
  });

  it("reports malformed JSON", () => {
    expect(problemsOf(theme({ "theme.json": "{ nope" })).join()).toMatch(/theme\.json/);
  });

  it("a logo or font that is not in assets/ is an error; traversal is not even a path", () => {
    expect(
      problemsOf(theme({ "theme.json": JSON.stringify({ logo: "logo.svg" }) })).join(),
    ).toMatch(/logo "logo\.svg" is not in/);
    expect(
      problemsOf(theme({ "theme.json": JSON.stringify({ logo: "../secret.png" }) })).join(),
    ).toMatch(/logo/);
    expect(
      problemsOf(
        theme({
          "theme.json": JSON.stringify({ fonts: { faces: [{ family: "X", file: "x.woff2" }] } }),
        }),
      ).join(),
    ).toMatch(/faces\.0\.file "x\.woff2" is not in/);
  });

  it("accepts assets that exist and declares font faces for you", () => {
    const t = loadTheme(
      theme({
        "assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
        "assets/fonts/Brand Sans.woff2": "x",
        "theme.json": JSON.stringify({
          logo: "logo.svg",
          fonts: {
            sans: "'Brand Sans', sans-serif",
            faces: [{ family: "Brand Sans", file: "fonts/Brand Sans.woff2", weight: "100 900" }],
          },
        }),
      }),
    );
    expect(t.css).toContain(
      '@font-face{font-family:"Brand Sans";src:url("/theme/assets/fonts/Brand%20Sans.woff2") format("woff2");font-weight:100 900',
    );
    expect(publicTheme(t, "en").logoUrl).toBe("/theme/assets/logo.svg");
  });
});

describe("messages", () => {
  it("deep-merges flat and nested overrides over the shipped catalogue", () => {
    const t = loadTheme(
      theme({
        "messages/en.json": JSON.stringify({ home: { title: "Hello" }, "home.cta": "Go" }),
        "messages/ca.json": JSON.stringify({ "home.title": "Hola" }),
      }),
    );
    expect(t.messages.en).toEqual({ "home.title": "Hello", "home.cta": "Go" });
    expect(t.messages.ca).toEqual({ "home.title": "Hola" });
    expect(t.messages.es).toEqual({});
    expect(publicTheme(t, "en").messages["home.title"]).toBe("Hello");
    expect(Object.keys(ca)).toContain("home.title");
  });

  it("reports unknown keys and dropped placeholders as warnings, non-strings as errors", () => {
    const t = loadTheme(
      theme({
        "messages/en.json": JSON.stringify({
          "home.titel": "typo",
          "teach.cohorts.drip.done": "Done.",
        }),
        "messages/fr.json": "{}",
      }),
    );
    expect(t.warnings.join("\n")).toMatch(/unknown message key "home\.titel"/);
    expect(t.warnings.join("\n")).toMatch(/drops \{n\}/);
    expect(t.warnings.join("\n")).toMatch(/messages\/fr\.json: ignored/);
    expect(t.messages.en["home.titel"]).toBeUndefined();
    expect(
      problemsOf(theme({ "messages/en.json": JSON.stringify({ "home.title": 3 }) })).join(),
    ).toMatch(/"home\.title" must be a string/);
  });

  it("flattenMessages handles nesting", () => {
    expect(flattenMessages({ a: { b: "x", c: { d: "y" } }, "e.f": "z" }, [], "f")).toEqual({
      "a.b": "x",
      "a.c.d": "y",
      "e.f": "z",
    });
  });
});

describe("emails and slots", () => {
  it("layout.html and <name>.html override the shipped layout", () => {
    const t = loadTheme(
      theme({
        "emails/layout.html": "<p>{{title}}</p>{{{lines}}}<a href='{{ctaUrl}}'>x</a>",
        "emails/auth_invite.html": "<b>{{title}}</b><a href='{{ctaUrl}}'>go</a>{{{lines}}}",
      }),
    );
    expect(t.emails.layout).toContain("<p>{{title}}</p>");
    expect(Object.keys(t.emails.byName)).toEqual(["auth_invite"]);
  });

  it("rejects a template without the link or with unknown placeholders", () => {
    const p = problemsOf(theme({ "emails/layout.html": "{{title}} {{nope}} {{lines}}" })).join(
      "\n",
    );
    expect(p).toMatch(/unknown placeholder \{\{nope\}\}/);
    expect(p).toMatch(/must contain \{\{ctaUrl\}\}/);
    expect(p).toMatch(/use \{\{\{lines\}\}\}/);
  });

  it("warns about unknown template and slot files and lists the slots present", () => {
    const t = loadTheme(
      theme({
        "emails/welcome.html": "x",
        "slots/Header.tsx": "export default () => null",
        "slots/Sidebar.tsx": "export default () => null",
      }),
    );
    expect(t.slots).toEqual(["Header"]);
    expect(t.warnings.join("\n")).toMatch(/emails\/welcome\.html: ignored/);
    expect(t.warnings.join("\n")).toMatch(/slots\/Sidebar\.tsx: ignored/);
  });
});

describe("publicTheme", () => {
  it("localises the tagline and legal links with the default locale as fallback", () => {
    const t = loadTheme(
      theme({
        "theme.json": JSON.stringify({
          defaultLocale: "es",
          tagline: { es: "Hola", en: "Hello" },
          legalLinks: [{ label: { es: "Privacidad" }, href: "/privacy" }],
        }),
      }),
    );
    expect(publicTheme(t, "en").tagline).toBe("Hello");
    expect(publicTheme(t, "ca").tagline).toBe("Hola");
    expect(publicTheme(t, "ca").legalLinks).toEqual([{ label: "Privacidad", href: "/privacy" }]);
    expect(publicTheme(t, "en").cssUrl).toMatch(/^\/theme\/theme\.css\?v=[0-9a-f]{10}$/);
  });
});

describe("deepMerge", () => {
  it("merges objects and replaces arrays", () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { b: 9 }, l: [3] })).toEqual({
      a: { b: 9, c: 2 },
      l: [3],
    });
  });
});

describe("resolveAsset", () => {
  const dir = theme({
    "assets/logo.svg": "<svg/>",
    "assets/fonts/a b.woff2": "x",
    "assets/notes.txt": "x",
    "outside.png": "x",
  });
  const assets = join(dir, "assets");
  it("serves allowed files with the right type", () => {
    expect(resolveAsset(assets, "logo.svg")?.contentType).toBe("image/svg+xml");
    expect(resolveAsset(assets, "fonts/a%20b.woff2")?.contentType).toBe("font/woff2");
  });
  it("refuses traversal, encoded traversal, backslashes, nulls, dotfiles and unknown types", () => {
    for (const bad of [
      "../outside.png",
      "%2e%2e/outside.png",
      "..%2foutside.png",
      "fonts/../../outside.png",
      "..\\outside.png",
      "logo.svg%00.png",
      "/etc/passwd",
      "%2Fetc%2Fpasswd",
      ".hidden.png",
      "notes.txt",
      "",
      "fonts",
      "%E0%A4%A",
    ])
      expect(resolveAsset(assets, bad), bad).toBeNull();
  });
  it("refuses a symlink that leaves the assets directory", () => {
    symlinkSync(join(dir, "outside.png"), join(assets, "link.png"));
    expect(resolveAsset(assets, "link.png")).toBeNull();
  });
});

describe("derived tokens set in one mode only", () => {
  it("warns, because the other mode would inherit the override", () => {
    const t = loadTheme(
      theme({ "theme.json": JSON.stringify({ colors: { light: { border: "#ccc" } } }) }),
    );
    expect(t.warnings.join()).toMatch(/colors\.light\.border is set but not in dark/);
    const ok = loadTheme(
      theme({
        "theme.json": JSON.stringify({
          colors: { light: { border: "#ccc" }, dark: { border: "#333" } },
        }),
      }),
    );
    expect(ok.warnings).toEqual([]);
  });
});

describe("font stacks", () => {
  it("reject unbalanced quotes", () => {
    expect(
      problemsOf(theme({ "theme.json": JSON.stringify({ fonts: { sans: 'a"' } }) })).join(),
    ).toMatch(/unbalanced quotes/);
  });
});
