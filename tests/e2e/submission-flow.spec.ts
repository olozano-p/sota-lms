import { expect, test } from "@playwright/test";
import { loginAs, open } from "./helpers";

const LESSON = "/courses/introduccio-a-la-contemplacio/diari";
const SUBMISSIONS = "/teach/courses/introduccio-a-la-contemplacio/submissions";

test("student submits an assignment, teacher returns feedback, student reads it", async ({
  browser,
}) => {
  const stamp = Date.now().toString().slice(-6);

  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await loginAs(student, "mock-student", LESSON);
  await student.getByRole("link", { name: /Obre la tasca|Open the assignment/ }).click();
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("Diari de pràctica");
  await student.getByRole("textbox", { name: /^Text/ }).fill(`Dia 1: he respirat. (${stamp})`);
  await student
    .getByRole("button", { name: /^Entrega$|^Submit$|Torna a entregar|Submit again/ })
    .click();
  await expect(student.getByText(/Entrega enviada|Submission sent/)).toBeVisible();
  await expect(student.getByText(`Dia 1: he respirat. (${stamp})`)).toBeVisible();

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await loginAs(teacher, "mock-teacher", SUBMISSIONS);
  const card = teacher
    .locator("li")
    .filter({ hasText: `(${stamp})` })
    .first();
  await expect(card).toBeVisible();
  await card.getByRole("textbox", { name: /Comentaris|Feedback/ }).fill(`Molt bé. (${stamp})`);
  await card.getByRole("button", { name: /Retorna amb comentaris|Return with feedback/ }).click();
  await expect(card.getByText(/Retornada|Returned/)).toBeVisible();

  await open(
    student,
    LESSON.replace(
      "/courses/introduccio-a-la-contemplacio/diari",
      "/courses/introduccio-a-la-contemplacio/diari",
    ),
  );
  await student.getByRole("link", { name: /Obre la tasca|Open the assignment/ }).click();
  await expect(student.getByText(`Molt bé. (${stamp})`)).toBeVisible();
  await expect(student.getByText(/Retornada|Returned/).first()).toBeVisible();

  await studentCtx.close();
  await teacherCtx.close();
});

test("student answers the quiz and sees the score; teacher sees results", async ({ browser }) => {
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await loginAs(student, "mock-student", "/courses/introduccio-a-la-contemplacio/repas");
  await student.getByRole("link", { name: /Obre el qüestionari|Open the quiz/ }).click();
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("Repàs del primer capítol");
  if (await student.getByRole("button", { name: /Torna-ho a fer|Try again/ }).isVisible()) {
    await student.getByRole("button", { name: /Torna-ho a fer|Try again/ }).click();
  }
  await student.getByRole("radio", { name: /Assegut/ }).check();
  await student.getByRole("checkbox", { name: /La respiració/ }).check();
  await student.getByRole("checkbox", { name: /Els sons/ }).check();
  await student
    .getByRole("textbox", { name: /La teva resposta|Your answer/ })
    .first()
    .fill("calma");
  await student.getByRole("button", { name: /Envia les respostes|Send answers/ }).click();
  await expect(student.getByText(/Puntuació: 100|Score: 100/)).toBeVisible();
  await expect(student.getByText(/Correcta|Correct/).first()).toBeVisible();

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await loginAs(teacher, "mock-teacher", "/teach/courses/introduccio-a-la-contemplacio/quizzes");
  await teacher
    .getByRole("link", { name: /Resultats|Results/ })
    .first()
    .click();
  await expect(teacher.getByText(/Aina Estudiant/).first()).toBeVisible();
  await expect(teacher.getByText(/persones han respost|people answered/)).toBeVisible();

  await studentCtx.close();
  await teacherCtx.close();
});

test("teacher opens the cohort editor and the quiz builder", async ({ page }) => {
  await loginAs(page, "mock-teacher", "/teach/courses/introduccio-a-la-contemplacio/cohorts");
  await page.getByRole("link", { name: "Grup de tardor 2026" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grup de tardor 2026");
  await expect(page.getByText("Aina Estudiant")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Calendari de publicació|Release schedule/ }),
  ).toBeVisible();

  await open(page, "/teach/courses/introduccio-a-la-contemplacio/quizzes");
  await page
    .getByRole("link", { name: /^Edita$|^Edit$/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Repàs del primer capítol");
  await expect(page.getByRole("textbox", { name: /Enunciat|Prompt/ })).toHaveCount(4);
});
