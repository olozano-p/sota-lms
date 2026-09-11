/**
 * Refreshes docs/screenshots against a running dev stack (pnpm dev + mock IdP + seed).
 *   node dev/screenshots.mjs docs/screenshots
 */
import { chromium } from "@playwright/test";
const base = "http://localhost:3003";
const out = process.argv[2];
const browser = await chromium.launch();
async function login(page, sub, returnTo) {
  await page.goto(`${base}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.waitForURL(/\/interaction\//);
  await page
    .locator(`form input[name="sub"][value="${sub}"]`)
    .locator("..")
    .locator("button")
    .click();
  await page.waitForURL((u) => !u.pathname.startsWith("/interaction"));
  await page.waitForSelector('html[data-hydrated="1"]', { state: "attached" });
}
const shots = [
  ["mock-student", "/courses", "courses.png"],
  ["mock-student", "/courses/introduccio-a-la-contemplacio", "syllabus.png"],
  ["mock-student", "/courses/introduccio-a-la-contemplacio/la-postura", "lesson.png"],
  ["mock-teacher", "/teach/courses/introduccio-a-la-contemplacio", "editor.png"],
  ["mock-admin", "/admin", "admin.png"],
];
for (const [sub, path, file] of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    locale: "ca-ES",
  });
  const page = await ctx.newPage();
  await login(page, sub, path);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${file}`, fullPage: false });
  await ctx.close();
}
// Dark variant of the lesson.
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem("lodro_theme", "dark"));
await login(page, "mock-student", "/courses/introduccio-a-la-contemplacio/la-postura");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/lesson-dark.png` });
await ctx.close();
await browser.close();
console.log("shots done");
