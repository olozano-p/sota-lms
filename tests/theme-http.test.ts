/** `/theme/theme.css` and `/theme/assets/*` as the route handlers serve them, against a real directory. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "sota-theme-http-"));
mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
writeFileSync(join(dir, "assets", "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
writeFileSync(join(dir, "assets", "fonts", "f.woff2"), "wOF2");
writeFileSync(join(dir, "assets", "page.html"), "<script>alert(1)</script>");
writeFileSync(join(dir, "custom.css"), "a{color:red}");
writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "Http", logo: "logo.svg" }));
process.env.THEME_DIR = dir;

const { resetEnvCache } = await import("../src/config/env.ts");
const { resetThemeCache } = await import("../src/theme/runtime.ts");
const { themeAssetResponse, themeCssResponse } = await import("../src/server/theme-http.ts");

beforeAll(() => {
  resetEnvCache();
  resetThemeCache();
});

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3003${path}`, { headers });

describe("theme.css", () => {
  it("serves variables then custom.css as text/css, immutable when versioned", async () => {
    const res = themeCssResponse(req("/theme/theme.css?v=abc"));
    expect(res.headers.get("content-type")).toMatch(/^text\/css/);
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = await res.text();
    expect(body.indexOf(":root{")).toBeLessThan(body.indexOf("a{color:red}"));
  });
  it("revalidates the unversioned URL and answers 304 to a matching ETag", async () => {
    const first = themeCssResponse(req("/theme/theme.css"));
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const again = themeCssResponse(
      req("/theme/theme.css", { "if-none-match": first.headers.get("etag")! }),
    );
    expect(again.status).toBe(304);
  });
});

describe("theme assets", () => {
  it("serves a file with its content type and nosniff; SVG gets a sandbox CSP", async () => {
    const res = await themeAssetResponse(req("/theme/assets/logo.svg"), "logo.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    const font = await themeAssetResponse(req("/x"), "fonts/f.woff2");
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(await font.text()).toBe("wOF2");
  });
  it("answers 404 for traversal, other directories, html and unknown files", async () => {
    for (const p of [
      "../theme.json",
      "%2e%2e%2ftheme.json",
      "page.html",
      "nope.png",
      "../custom.css",
    ])
      expect((await themeAssetResponse(req("/x"), p)).status, p).toBe(404);
  });
  it("answers 304 to a matching ETag and no body to HEAD", async () => {
    const first = await themeAssetResponse(req("/x"), "logo.svg");
    const cached = await themeAssetResponse(
      req("/x", { "if-none-match": first.headers.get("etag")! }),
      "logo.svg",
    );
    expect(cached.status).toBe(304);
    const head = await themeAssetResponse(
      new Request("http://localhost/x", { method: "HEAD" }),
      "logo.svg",
    );
    expect(await head.text()).toBe("");
  });
});
