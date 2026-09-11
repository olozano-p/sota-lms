import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import {
  course,
  person,
  question,
  questionOption,
  quiz,
  quizAnswer,
  quizAttempt,
} from "~/db/schema";
import { renderMarkdown } from "~/lib/markdown";
import { grade } from "~/lib/quiz-grading";
import { AuthorizationError, requireCourseTeacher, requireUser } from "~/server/auth/authz";
import { requireContainerAccess } from "~/server/access/container";

async function questionsOf(quizId: string) {
  const qs = await db
    .select()
    .from(question)
    .where(eq(question.quizId, quizId))
    .orderBy(asc(question.sort));
  const opts = qs.length
    ? await db
        .select()
        .from(questionOption)
        .where(
          inArray(
            questionOption.questionId,
            qs.map((q) => q.id),
          ),
        )
        .orderBy(asc(questionOption.sort))
    : [];
  return qs.map((q) => ({ ...q, options: opts.filter((o) => o.questionId === q.id) }));
}

/** Student view: questions (answers hidden unless the quiz reveals them after a submission) and the latest attempt. */
export const getQuiz = createServerFn({ method: "GET" })
  .validator(z.object({ quizId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [row] = await db
      .select({ quiz, course })
      .from(quiz)
      .innerJoin(course, eq(course.id, quiz.courseId))
      .where(eq(quiz.id, data.quizId))
      .limit(1);
    if (!row) return null;
    let access;
    try {
      access = await requireContainerAccess(user, "quiz", row.quiz.id, row.course.id);
    } catch (e) {
      if (e instanceof AuthorizationError) return null;
      throw e;
    }
    const qs = await questionsOf(row.quiz.id);
    const attempts = await db
      .select()
      .from(quizAttempt)
      .where(and(eq(quizAttempt.quizId, row.quiz.id), eq(quizAttempt.personId, user.id)))
      .orderBy(desc(quizAttempt.startedAt));
    const latest = attempts[0] ?? null;
    const answers = latest
      ? await db.select().from(quizAnswer).where(eq(quizAnswer.attemptId, latest.id))
      : [];
    const reveal = access.privileged || (latest !== null && row.quiz.showAnswersAfterSubmit);
    const graded = latest
      ? grade(
          qs.map((q) => ({
            id: q.id,
            type: q.type,
            required: q.required,
            correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
          })),
          answers.map((a) => ({ questionId: a.questionId, optionIds: a.optionIds, text: a.text })),
          row.quiz.passThreshold,
        )
      : null;
    return {
      quiz: {
        id: row.quiz.id,
        title: row.quiz.title,
        introHtml: renderMarkdown(row.quiz.introMd),
        kind: row.quiz.kind,
        showAnswersAfterSubmit: row.quiz.showAnswersAfterSubmit,
        passThreshold: row.quiz.passThreshold,
      },
      course: { id: row.course.id, slug: row.course.slug, title: row.course.title },
      lesson: access.lesson,
      privileged: access.privileged,
      questions: qs.map((q) => ({
        id: q.id,
        type: q.type,
        promptHtml: renderMarkdown(q.promptMd),
        required: q.required,
        options: q.options.map((o) => ({
          id: o.id,
          label: o.label,
          isCorrect: reveal ? o.isCorrect : null,
        })),
      })),
      latestAttempt: latest
        ? {
            id: latest.id,
            submittedAt: latest.submittedAt,
            score: latest.score,
            passed: latest.passed,
            answers: answers.map((a) => ({
              questionId: a.questionId,
              optionIds: a.optionIds,
              text: a.text,
            })),
            correctByQuestion: reveal ? graded!.correctByQuestion : null,
          }
        : null,
      attemptCount: attempts.length,
    };
  });

export const listCourseQuizzes = createServerFn({ method: "GET" })
  .validator(z.object({ courseSlug: z.string() }))
  .handler(async ({ data }) => {
    const [c] = await db.select().from(course).where(eq(course.slug, data.courseSlug)).limit(1);
    if (!c) return null;
    await requireCourseTeacher(c.id);
    const rows = await db.select().from(quiz).where(eq(quiz.courseId, c.id)).orderBy(quiz.title);
    return { course: { id: c.id, slug: c.slug }, quizzes: rows };
  });

export const getQuizEditor = createServerFn({ method: "GET" })
  .validator(z.object({ quizId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ quiz, course })
      .from(quiz)
      .innerJoin(course, eq(course.id, quiz.courseId))
      .where(eq(quiz.id, data.quizId))
      .limit(1);
    if (!row) return null;
    await requireCourseTeacher(row.course.id);
    return {
      quiz: row.quiz,
      course: { id: row.course.id, slug: row.course.slug, title: row.course.title },
      questions: await questionsOf(row.quiz.id),
    };
  });

export const getQuizResults = createServerFn({ method: "GET" })
  .validator(z.object({ quizId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ quiz, course })
      .from(quiz)
      .innerJoin(course, eq(course.id, quiz.courseId))
      .where(eq(quiz.id, data.quizId))
      .limit(1);
    if (!row) return null;
    await requireCourseTeacher(row.course.id);
    const qs = await questionsOf(row.quiz.id);
    const attempts = await db
      .select({
        id: quizAttempt.id,
        personId: person.id,
        personName: person.name,
        personEmail: person.email,
        submittedAt: quizAttempt.submittedAt,
        score: quizAttempt.score,
        passed: quizAttempt.passed,
      })
      .from(quizAttempt)
      .innerJoin(person, eq(person.id, quizAttempt.personId))
      .where(eq(quizAttempt.quizId, row.quiz.id))
      .orderBy(desc(quizAttempt.startedAt));
    const answers = attempts.length
      ? await db
          .select()
          .from(quizAnswer)
          .where(
            inArray(
              quizAnswer.attemptId,
              attempts.map((a) => a.id),
            ),
          )
      : [];
    // Latest attempt per person drives the aggregates.
    const latestByPerson = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts)
      if (!latestByPerson.has(a.personId)) latestByPerson.set(a.personId, a);
    const latestIds = new Set([...latestByPerson.values()].map((a) => a.id));
    const latestAnswers = answers.filter((a) => latestIds.has(a.attemptId));
    return {
      quiz: {
        id: row.quiz.id,
        title: row.quiz.title,
        kind: row.quiz.kind,
        passThreshold: row.quiz.passThreshold,
      },
      course: { id: row.course.id, slug: row.course.slug, title: row.course.title },
      attempts,
      questions: qs.map((q) => ({
        id: q.id,
        type: q.type,
        promptHtml: renderMarkdown(q.promptMd),
        options: q.options.map((o) => ({
          id: o.id,
          label: o.label,
          isCorrect: o.isCorrect,
          count: latestAnswers.filter((a) => a.questionId === q.id && a.optionIds.includes(o.id))
            .length,
        })),
        texts: latestAnswers
          .filter((a) => a.questionId === q.id && a.text)
          .map((a) => ({
            text: a.text!,
            personName: attempts.find((x) => x.id === a.attemptId)?.personName ?? "",
          })),
      })),
      respondents: latestByPerson.size,
    };
  });
