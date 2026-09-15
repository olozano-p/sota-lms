import { expect, test } from "@playwright/test";
import { loginAs, open } from "./helpers";

const COURSE = "/courses/introduccio-a-la-contemplacio";
const SETTINGS = "/teach/courses/introduccio-a-la-contemplacio/settings";

test("student opens a thread, teacher quotes and pins it, student reacts", async ({ browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const title = `Pregunta e2e ${stamp}`;

  // The teacher makes sure the course forum is on (idempotent: the seed may already have done it).
  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await loginAs(teacher, "mock-teacher", SETTINGS);
  const toggle = teacher.getByRole("checkbox", { name: /Activa el fòrum|Enable the forum/ });
  if (!(await toggle.isChecked())) {
    await toggle.check();
    await expect(teacher.getByRole("status").filter({ hasText: /Desat|Saved/ })).toBeVisible();
  }

  // The student finds the tab, opens a thread with bold text and a video link.
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await loginAs(student, "mock-student", COURSE);
  await student
    .getByRole("navigation", { name: /Introducció/ })
    .getByRole("link", { name: /Fòrum|Forum/ })
    .click();
  await student.getByRole("link", { name: /Nou fil|New thread/ }).click();
  await student.getByRole("textbox", { name: /Títol|Title/ }).fill(title);
  const editor = student.locator('[contenteditable="true"]').first();
  await editor.click();
  await student.keyboard.type("Una pregunta ");
  await student.keyboard.press("ControlOrMeta+b");
  await student.keyboard.type("important");
  await student.keyboard.press("ControlOrMeta+b");
  await student.keyboard.press("Enter");
  await student.keyboard.type("https://youtu.be/dQw4w9WgXcQ");
  await student.keyboard.press("Enter");
  await expect(editor.locator("figure iframe")).toHaveCount(1);
  await student.getByRole("button", { name: /Publica el fil|Post the thread/ }).click();
  await expect(student.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(student.locator("article strong", { hasText: "important" })).toBeVisible();
  await expect(student.locator("article figure.embed iframe")).toHaveCount(1);
  const threadUrl = student.url();

  // The teacher quotes the opening post, replies and pins the thread.
  await open(teacher, new URL(threadUrl).pathname);
  await teacher
    .getByRole("button", { name: /^Cita$|^Quote$/ })
    .first()
    .click();
  await expect(teacher.getByText(/Responent a Aina|Replying to Aina/)).toBeVisible();
  await teacher.keyboard.type(`Bona pregunta (${stamp}).`);
  await teacher.getByRole("button", { name: /Publica la resposta|Post the reply/ }).click();
  const reply = teacher.locator("article").filter({ hasText: `Bona pregunta (${stamp})` });
  await expect(reply).toBeVisible();
  await expect(reply.locator("blockquote")).toBeVisible();
  await expect(reply.getByText(/En resposta a Aina|In reply to Aina/)).toBeVisible();
  await expect(reply.getByText(/Docent|Teacher/)).toBeVisible();
  await teacher.getByRole("button", { name: /^Fixa$|^Pin$/ }).click();
  await expect(teacher.getByRole("button", { name: /Desfixa|Unpin/ })).toBeVisible();

  // Pinned threads lead the listing.
  await open(student, `${COURSE}/forum`);
  const list = student.locator("main li");
  await expect(list.first()).toContainText(title);

  // The student likes the reply, then takes it back; their own post cannot be reacted to.
  await open(student, new URL(threadUrl).pathname);
  const studentReply = student.locator("article").filter({ hasText: `Bona pregunta (${stamp})` });
  const like = studentReply.getByRole("button", { name: /M'agrada|^Like$/ });
  await like.click();
  await expect(like).toHaveText("1");
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await like.click();
  await expect(like).toHaveText("0");
  await expect(
    student
      .locator("article")
      .first()
      .getByRole("button", { name: /M'agrada|^Like$/ }),
  ).toBeDisabled();

  // The general forum is one click away for everyone.
  await student
    .getByRole("navigation", { name: /Compte|Account/ })
    .getByRole("link", { name: /Fòrum|Forum/ })
    .click();
  await expect(student.getByRole("heading", { level: 1, name: /Fòrum|Forum/ })).toBeVisible();

  // Clean up: the teacher deletes the thread.
  await open(teacher, new URL(threadUrl).pathname);
  await teacher.getByRole("button", { name: /Suprimeix el fil|Delete the thread/ }).click();
  await teacher
    .getByRole("dialog")
    .getByRole("button", { name: /^Suprimeix$|^Delete$/ })
    .click();
  await expect(teacher).toHaveURL(/\/forum$/);
  await expect(teacher.getByRole("link", { name: title })).toHaveCount(0);

  await studentCtx.close();
  await teacherCtx.close();
});
