import { expect, test, type Locator } from "@playwright/test";
import { loginAs, open } from "./helpers";

/** Chapters in the syllabus panel are collapsible; open one if it is closed. */
async function openChapter(nav: Locator, name: RegExp) {
  const button = nav.getByRole("button", { name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

const COURSE = "/courses/introduccio-a-la-contemplacio";

test("student reads a lesson, marks it done and sees progress; drip lock is explained", async ({
  page,
}) => {
  await loginAs(page, "mock-student", COURSE);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Introducció a la contemplació",
  );

  // The syllabus panel lists the lessons; the drip-locked one says when it opens.
  const nav = page.getByRole("navigation", { name: /temari|syllabus|temario/i });
  await openChapter(nav, /Asseure's/);
  await openChapter(nav, /Obrir-se/);
  await expect(nav.getByRole("link", { name: /Benvinguda/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /Els sons/ })).toHaveAttribute(
    "title",
    /Disponible|Available/,
  );

  await nav.getByRole("link", { name: /La postura/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("La postura");
  await expect(page.getByText("Els set punts")).toBeVisible();
  await expect(page.locator("audio")).toBeAttached();

  // A previous run may have left the lesson completed; start from a clean state.
  const undo = page.getByRole("button", { name: /Desmarca|Unmark/ });
  if (await undo.isVisible()) {
    await undo.click();
    await expect(page.getByRole("button", { name: /Marca com a feta|Mark as done/ })).toBeVisible();
  }
  await page.getByRole("button", { name: /Marca com a feta|Mark as done/ }).click();
  await expect(page.getByText(/Lliçó completada|Lesson completed/)).toBeVisible();

  // Next goes to the quiz lesson; arrow left comes back.
  await page.getByRole("link", { name: /Següent|Next/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Repàs");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("La postura");

  await open(page, COURSE);
  await expect(page.getByText(/[1-9] de \d+ lliçons|[1-9] of \d+ lessons/).first()).toBeVisible();
  await openChapter(nav, /Asseure's/);
  await expect(nav.getByRole("link", { name: /La postura/ })).toHaveAttribute(
    "title",
    /Completada|Completed/,
  );

  // The locked lesson page shows the reason, not the content.
  await open(page, `${COURSE}/els-sons`);
  await expect(page.getByText(/Encara no disponible|Not available yet/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("the course list files a started course under «In progress»", async ({ page }) => {
  await loginAs(page, "mock-student");
  const active = page.getByRole("region", { name: /^En curs$|^In progress$/ });
  await expect(active.getByRole("listitem")).toHaveCount(1);
  await expect(active.getByRole("link", { name: /Ves al meu curs|Go to my course/ })).toBeVisible();
});
