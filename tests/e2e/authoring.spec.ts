import { expect, test } from "@playwright/test";
import { loginAs, open } from "./helpers";

const EDITOR = "/teach/courses/introduccio-a-la-contemplacio";

test("teacher adds a chapter, a lesson and a text block, publishes, then cleans up", async ({
  page,
}) => {
  await loginAs(page, "mock-teacher", EDITOR);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Introducció a la contemplació");

  const stamp = Date.now().toString().slice(-6);
  const chapterTitle = `Capítol e2e ${stamp}`;
  await page.getByRole("textbox", { name: /Afegeix un capítol|Add a chapter/ }).fill(chapterTitle);
  await page.getByRole("button", { name: /Afegeix un capítol|Add a chapter/ }).click();
  const chapterInputs = page.getByRole("textbox", { name: /Títol del capítol|Chapter title/ });
  await expect(chapterInputs.last()).toHaveValue(chapterTitle);

  const chapterRow = page.locator("li").filter({ has: chapterInputs.last() }).last();
  await chapterRow.getByPlaceholder(/Nova lliçó|New lesson/).fill(`Lliçó e2e ${stamp}`);
  await chapterRow.getByRole("button", { name: /Afegeix una lliçó|Add a lesson/ }).click();
  const lessonLink = page.getByRole("link", { name: `Lliçó e2e ${stamp}` });
  await expect(lessonLink).toBeVisible();
  await lessonLink.click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Lliçó e2e ${stamp}`);
  await page.getByRole("button", { name: /^Afegeix$|^Add$/ }).click();
  // The rich-text editor: `## ` is an input rule for a heading, Enter starts a paragraph.
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(`## Hola ${stamp}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Text de prova.");
  await editor.blur();
  await expect(page.getByRole("status").filter({ hasText: /Desat|Saved/ })).toBeVisible();

  // A file block: signed PUT to storage, then the server records the file.
  await page.getByRole("combobox", { name: /Afegeix un bloc|Add a block/ }).selectOption("file");
  await page.getByRole("button", { name: /^Afegeix$|^Add$/ }).click();
  // The text block's editor has a hidden image input too; the file block's input carries a label.
  const fileInput = page.getByLabel(/Puja un fitxer|Upload a file/);
  await fileInput.setInputFiles({
    name: `notes-${stamp}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("hola"),
  });
  await expect(page.getByText(`notes-${stamp}.txt`, { exact: false })).toBeVisible();

  await page
    .getByRole("button", { name: /^Publica$|^Publish$/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Despublica|Unpublish/ }).first()).toBeVisible();

  // Student view shows the new lesson content.
  await page.getByRole("link", { name: /Vista prèvia|Preview/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: `Hola ${stamp}` })).toBeVisible();
  await expect(page.getByRole("link", { name: /Descarrega|Download/ })).toBeVisible();

  // Clean up so the learner specs keep a stable syllabus.
  await open(page, EDITOR);
  const row = page
    .locator("li")
    .filter({
      has: page
        .getByRole("textbox", { name: /Títol del capítol|Chapter title/ })
        .and(page.locator(`[value="${chapterTitle}"]`)),
    })
    .first();
  await row.getByRole("button", { name: /Suprimeix el capítol|Delete chapter/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Suprimeix$|^Delete$/ })
    .click();
  await expect(page.getByRole("link", { name: `Lliçó e2e ${stamp}` })).toHaveCount(0);
});
