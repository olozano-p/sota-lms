import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("a protected page redirects to the IdP and comes back signed in", async ({ page }) => {
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/interaction\//);
  await page
    .locator('input[name="sub"][value="mock-student"]')
    .locator("..")
    .locator("button")
    .click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/cursos|courses/i);
  await expect(
    page
      .getByText("Aina Estudiant", { exact: false })
      .or(page.locator('[title*="Aina Estudiant"]')),
  ).toBeAttached();
});

test("a student cannot open the admin or teach areas", async ({ page }) => {
  await loginAs(page, "mock-student");
  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(404);
  const teach = await page.goto("/teach");
  expect(teach?.status()).toBe(404);
});

test("sign-out clears the session and ends the IdP session", async ({ page }) => {
  await loginAs(page, "mock-student");
  await page.goto("/auth/logout");
  await expect(page).toHaveURL(/localhost:3013\/session\/end/);
  // The IdP asks for confirmation; without it SSO would sign the student straight back in.
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/interaction\//);
});
