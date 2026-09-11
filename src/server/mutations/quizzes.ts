import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import {
  QUESTION_TYPES,
  QUIZ_KINDS,
  course,
  lessonProgress,
  question,
  questionOption,
  quiz,
  quizAnswer,
  quizAttempt,
} from "~/db/schema";
import { grade } from "~/lib/quiz-grading";
import { audit } from "~/server/audit";
import { requireCourseTeacher, requireUser } from "~/server/auth/authz";
import { requireContainerAccess } from "~/server/access/container";

const id = z.string().uuid();

async function courseIdOfQuiz(quizId: string) {
  const [q] = await db
    .select({ courseId: quiz.courseId })
    .from(quiz)
    .where(eq(quiz.id, quizId))
    .limit(1);
  if (!q) throw new Error("quiz not found");
  return q.courseId;
}
async function quizIdOfQuestion(questionId: string) {
  const [q] = await db
    .select({ quizId: question.quizId })
    .from(question)
    .where(eq(question.id, questionId))
    .limit(1);
  if (!q) throw new Error("question not found");
  return q.quizId;
}
async function questionIdOfOption(optionId: string) {
  const [o] = await db
    .select({ questionId: questionOption.questionId })
    .from(questionOption)
    .where(eq(questionOption.id, optionId))
    .limit(1);
  if (!o) throw new Error("option not found");
  return o.questionId;
}

// ---------- Quiz ----------

export const createQuiz = createServerFn({ method: "POST" })
  .validator(
    z.object({
      courseId: id,
      title: z.string().trim().min(1).max(200),
      kind: z.enum(QUIZ_KINDS).default("quiz"),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(quiz)
        .values({ courseId: data.courseId, title: data.title, kind: data.kind })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "quiz.create",
        entity: "quiz",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateQuiz = createServerFn({ method: "POST" })
  .validator(
    z.object({
      quizId: id,
      patch: z
        .object({
          title: z.string().trim().min(1).max(200),
          introMd: z.string().max(50_000),
          kind: z.enum(QUIZ_KINDS),
          showAnswersAfterSubmit: z.boolean(),
          passThreshold: z.number().min(0).max(100).nullable(),
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfQuiz(data.quizId));
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(quiz).where(eq(quiz.id, data.quizId)).limit(1);
      const [after] = await tx
        .update(quiz)
        .set(data.patch)
        .where(eq(quiz.id, data.quizId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "quiz.update",
        entity: "quiz",
        entityId: data.quizId,
        before,
        after,
      });
      return after!;
    });
  });

export const deleteQuiz = createServerFn({ method: "POST" })
  .validator(z.object({ quizId: id }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfQuiz(data.quizId));
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(quiz).where(eq(quiz.id, data.quizId)).limit(1);
      await tx.delete(quiz).where(eq(quiz.id, data.quizId));
      await audit(tx, {
        actorId: user.id,
        action: "quiz.delete",
        entity: "quiz",
        entityId: data.quizId,
        before,
      });
      return { ok: true };
    });
  });

// ---------- Questions and options ----------

export const createQuestion = createServerFn({ method: "POST" })
  .validator(
    z.object({
      quizId: id,
      type: z.enum(QUESTION_TYPES),
      promptMd: z.string().trim().min(1).max(5000).default("…"),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfQuiz(data.quizId));
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ sort: question.sort })
        .from(question)
        .where(eq(question.quizId, data.quizId));
      const [row] = await tx
        .insert(question)
        .values({
          quizId: data.quizId,
          type: data.type,
          promptMd: data.promptMd,
          sort: Math.max(0, ...siblings.map((s) => s.sort)) + 1,
        })
        .returning();
      if (data.type === "single_choice" || data.type === "multi_choice") {
        await tx.insert(questionOption).values([
          { questionId: row!.id, sort: 1, label: "", isCorrect: true },
          { questionId: row!.id, sort: 2, label: "", isCorrect: false },
        ]);
      }
      await audit(tx, {
        actorId: user.id,
        action: "question.create",
        entity: "question",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateQuestion = createServerFn({ method: "POST" })
  .validator(
    z.object({
      questionId: id,
      patch: z
        .object({
          promptMd: z.string().trim().min(1).max(5000),
          required: z.boolean(),
          type: z.enum(QUESTION_TYPES),
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(
      await courseIdOfQuiz(await quizIdOfQuestion(data.questionId)),
    );
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(question)
        .where(eq(question.id, data.questionId))
        .limit(1);
      const [after] = await tx
        .update(question)
        .set(data.patch)
        .where(eq(question.id, data.questionId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "question.update",
        entity: "question",
        entityId: data.questionId,
        before,
        after,
      });
      return after!;
    });
  });

export const deleteQuestion = createServerFn({ method: "POST" })
  .validator(z.object({ questionId: id }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(
      await courseIdOfQuiz(await quizIdOfQuestion(data.questionId)),
    );
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(question)
        .where(eq(question.id, data.questionId))
        .limit(1);
      await tx.delete(question).where(eq(question.id, data.questionId));
      await audit(tx, {
        actorId: user.id,
        action: "question.delete",
        entity: "question",
        entityId: data.questionId,
        before,
      });
      return { ok: true };
    });
  });

export const reorderQuestions = createServerFn({ method: "POST" })
  .validator(z.object({ quizId: id, orderedIds: z.array(id) }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfQuiz(data.quizId));
    return db.transaction(async (tx) => {
      const existing = (
        await tx
          .select({ id: question.id })
          .from(question)
          .where(eq(question.quizId, data.quizId))
          .orderBy(asc(question.sort))
      ).map((r) => r.id);
      const order = [
        ...data.orderedIds.filter((x) => existing.includes(x)),
        ...existing.filter((x) => !data.orderedIds.includes(x)),
      ];
      for (const [i, qid] of order.entries())
        await tx
          .update(question)
          .set({ sort: i + 1 })
          .where(eq(question.id, qid));
      await audit(tx, {
        actorId: user.id,
        action: "question.reorder",
        entity: "quiz",
        entityId: data.quizId,
        after: order,
      });
      return { ok: true };
    });
  });

export const createOption = createServerFn({ method: "POST" })
  .validator(z.object({ questionId: id }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(
      await courseIdOfQuiz(await quizIdOfQuestion(data.questionId)),
    );
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ sort: questionOption.sort })
        .from(questionOption)
        .where(eq(questionOption.questionId, data.questionId));
      const [row] = await tx
        .insert(questionOption)
        .values({
          questionId: data.questionId,
          label: "",
          sort: Math.max(0, ...siblings.map((s) => s.sort)) + 1,
        })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "option.create",
        entity: "question_option",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateOption = createServerFn({ method: "POST" })
  .validator(
    z.object({
      optionId: id,
      patch: z.object({ label: z.string().max(500), isCorrect: z.boolean() }).partial(),
    }),
  )
  .handler(async ({ data }) => {
    const questionId = await questionIdOfOption(data.optionId);
    const user = await requireCourseTeacher(
      await courseIdOfQuiz(await quizIdOfQuestion(questionId)),
    );
    return db.transaction(async (tx) => {
      const [q] = await tx
        .select({ type: question.type })
        .from(question)
        .where(eq(question.id, questionId))
        .limit(1);
      // Single choice keeps exactly one correct option.
      if (data.patch.isCorrect === true && q?.type === "single_choice") {
        await tx
          .update(questionOption)
          .set({ isCorrect: false })
          .where(eq(questionOption.questionId, questionId));
      }
      const [after] = await tx
        .update(questionOption)
        .set(data.patch)
        .where(eq(questionOption.id, data.optionId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "option.update",
        entity: "question_option",
        entityId: data.optionId,
        after,
      });
      return after!;
    });
  });

export const deleteOption = createServerFn({ method: "POST" })
  .validator(z.object({ optionId: id }))
  .handler(async ({ data }) => {
    const questionId = await questionIdOfOption(data.optionId);
    const user = await requireCourseTeacher(
      await courseIdOfQuiz(await quizIdOfQuestion(questionId)),
    );
    return db.transaction(async (tx) => {
      await tx.delete(questionOption).where(eq(questionOption.id, data.optionId));
      await audit(tx, {
        actorId: user.id,
        action: "option.delete",
        entity: "question_option",
        entityId: data.optionId,
      });
      return { ok: true };
    });
  });

// ---------- Attempts ----------

export const submitQuizAttempt = createServerFn({ method: "POST" })
  .validator(
    z.object({
      quizId: id,
      answers: z.array(
        z.object({
          questionId: id,
          optionIds: z.array(id).default([]),
          text: z.string().max(20_000).nullable().default(null),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [row] = await db
      .select({ quiz, course })
      .from(quiz)
      .innerJoin(course, eq(course.id, quiz.courseId))
      .where(eq(quiz.id, data.quizId))
      .limit(1);
    if (!row) throw new Error("quiz not found");
    const access = await requireContainerAccess(user, "quiz", row.quiz.id, row.course.id);
    const qs = await db
      .select()
      .from(question)
      .where(eq(question.quizId, row.quiz.id))
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
      : [];
    const optionsOf = (qid: string) => opts.filter((o) => o.questionId === qid);
    // Only options that belong to the question count; one option at most for single choice.
    const cleaned = data.answers
      .filter((a) => qs.some((q) => q.id === a.questionId))
      .map((a) => {
        const q = qs.find((x) => x.id === a.questionId)!;
        const valid = a.optionIds.filter((oid) => optionsOf(q.id).some((o) => o.id === oid));
        return {
          questionId: a.questionId,
          optionIds:
            q.type === "single_choice" ? valid.slice(0, 1) : q.type === "multi_choice" ? valid : [],
          text: q.type === "short_text" || q.type === "long_text" ? a.text?.trim() || null : null,
        };
      });
    const result = grade(
      qs.map((q) => ({
        id: q.id,
        type: q.type,
        required: q.required,
        correctOptionIds: optionsOf(q.id)
          .filter((o) => o.isCorrect)
          .map((o) => o.id),
      })),
      cleaned,
      row.quiz.passThreshold,
    );
    if (result.missingRequired.length)
      return { ok: false as const, missingRequired: result.missingRequired };

    return db.transaction(async (tx) => {
      const now = new Date();
      const [attempt] = await tx
        .insert(quizAttempt)
        .values({
          quizId: row.quiz.id,
          personId: user.id,
          submittedAt: now,
          score: result.score,
          passed: result.passed,
        })
        .returning();
      if (cleaned.length)
        await tx.insert(quizAnswer).values(
          cleaned.map((a) => ({
            attemptId: attempt!.id,
            questionId: a.questionId,
            optionIds: a.optionIds,
            text: a.text,
          })),
        );
      if (access.lesson && !access.privileged) {
        await tx
          .insert(lessonProgress)
          .values({
            personId: user.id,
            lessonId: access.lesson.id,
            status: "completed",
            completedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [lessonProgress.personId, lessonProgress.lessonId],
            set: { status: "completed", completedAt: now, updatedAt: now },
          });
      }
      await audit(tx, {
        actorId: user.id,
        action: "quiz.attempt",
        entity: "quiz_attempt",
        entityId: attempt!.id,
        after: { quizId: row.quiz.id, score: result.score, passed: result.passed },
      });
      return {
        ok: true as const,
        attemptId: attempt!.id,
        score: result.score,
        passed: result.passed,
      };
    });
  });

export { and };
