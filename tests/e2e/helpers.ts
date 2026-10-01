import type { Page } from "@playwright/test";

/** Waits until React has hydrated; interacting earlier loses controlled-input state. */
export async function ready(page: Page) {
  await page.waitForSelector('html[data-hydrated="1"]', { state: "attached" });
}

/** Completes the mock IdP flow: any protected URL → IdP button list → back with a session. */
export async function loginAs(
  page: Page,
  sub: "mock-student" | "mock-delayed" | "mock-teacher" | "mock-admin" | "mock-service-learner",
  returnTo = "/courses",
) {
  await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.waitForURL(/\/interaction\//);
  await page
    .locator(`form input[name="sub"][value="${sub}"]`)
    .locator("..")
    .locator("button")
    .click();
  await page.waitForURL(
    (u) => u.origin === new URL(page.url()).origin && !u.pathname.startsWith("/interaction"),
  );
  await ready(page);
}

/** goto + hydration wait. */
export async function open(page: Page, url: string) {
  const res = await page.goto(url);
  if (res && res.status() < 400) await ready(page);
  return res;
}
