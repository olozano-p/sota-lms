/**
 * Phase 2 exit: a cohort of three learners moves through a dripped course and one of them submits
 * an assignment that an instructor reviews. Everything goes through the real mutations on PGlite;
 * only the request-bound guards are replaced by a switchable "who is calling" and the clock is
 * driven by fake timers (`Date` only), so the drip is exercised the way it runs in production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

let caller: import("../src/server/auth/authz.ts").SessionUser;

// Server functions need the framework's request context; here they are plain functions that still
// run their Zod validator, so defaults and refusals behave as in production.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null;
    const builder = {
      validator(s: typeof schema) {
        schema = s;
        return builder;
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return (opts?: { data?: unknown }) =>
          fn({ data: schema ? schema.parse(opts?.data) : opts?.data });
      },
    };
    return builder;
  },
}));
vi.mock("../src/server/services/email/mailer.ts", () => ({ sendMail: async () => {} }));
vi.mock("../src/server/auth/authz.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/auth/authz.ts")>();
  const requireUser = async () => caller;
  const requireRole = async (...roles: Parameters<typeof real.hasRole>[1][]) => {
    if (!real.hasRole(caller, "admin", ...roles)) throw new real.AuthorizationError(403);
    return caller;
  };
  return {
    ...real,
    requireUser,
    requireRole,
    // Same rule as the real guard, minus the request: admins pass, teachers need the assignment.
    requireCourseTeacher: async (courseId: string) => {
      const user = await requireRole("teacher");
      if (real.hasRole(user, "admin")) return user;
      const { db } = await import("../src/db/index.ts");
      const { courseTeacher } = await import("../src/db/schema.ts");
      const rows = await db
        .select()
        .from(courseTeacher)
        .where(and(eq(courseTeacher.courseId, courseId), eq(courseTeacher.personId, user.id)));
      if (!rows[0]) throw new real.AuthorizationError(403);
      return user;
    },
  };
});

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const s = await import("../src/db/schema.ts");
const { AuthorizationError } = await import("../src/server/auth/authz.ts");
const { createCohort, applyCohortDrip } = await import("../src/server/mutations/cohorts.ts");
const { enrollByEmails } = await import("../src/server/mutations/enrollments.ts");
const { createAssignment, submitAssignment, reviewSubmission } =
  await import("../src/server/mutations/assignments.ts");
const { createQuiz, createQuestion, submitQuizAttempt } =
  await import("../src/server/mutations/quizzes.ts");
const { setLessonCompleted } = await import("../src/server/mutations/progress.ts");
const { listSubmissions } = await import("../src/server/queries/assignments.ts");
const { courseProgress } = await import("../src/lib/progress.ts");
const { loadPersonFacts, decideLessons } = await import("../src/server/access/require.ts");

type User = typeof caller;
const asUser = (p: typeof s.person.$inferSelect): User => ({
  id: p.id,
  sub: null,
  name: p.name,
  email: p.email,
  roles: p.roles as User["roles"],
  locale: null,
  sessionId: "test",
});

const START = "2026-09-01";
const at = (iso: string) => vi.setSystemTime(new Date(iso));

let teacher: User;
let learners: User[];
let outsider: User;
let course: typeof s.course.$inferSelect;
let lessons: (typeof s.lesson.$inferSelect)[];
let cohortSlug: string;
let assignmentId: string;
let quizId: string;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(`${START}T08:00:00Z`);
  await runMigrations();

  const [t] = await db
    .insert(s.person)
    .values({ email: "teacher@example.invalid", name: "Teacher", roles: ["teacher"] })
    .returning();
  teacher = asUser(t!);
  const [o] = await db
    .insert(s.person)
    .values({ email: "outsider@example.invalid", name: "Outsider", roles: ["student"] })
    .returning();
  outsider = asUser(o!);

  // A published course of three chapters, one lesson each.
  const [c] = await db
    .insert(s.course)
    .values({ slug: "journey", title: "Journey", language: "en", status: "published" })
    .returning();
  course = c!;
  await db.insert(s.courseTeacher).values({ courseId: course.id, personId: teacher.id });
  const chapters = await db
    .insert(s.chapter)
    .values(
      [1, 2, 3].map((n) => ({ courseId: course.id, slug: `ch${n}`, title: `Ch ${n}`, sort: n })),
    )
    .returning();
  lessons = await db
    .insert(s.lesson)
    .values(
      chapters
        .sort((a, b) => a.sort - b.sort)
        .map((ch, i) => ({
          chapterId: ch.id,
          slug: `l${i + 1}`,
          title: `Lesson ${i + 1}`,
          status: "published" as const,
        })),
    )
    .returning();

  // Lesson 1 embeds an assignment, lesson 2 a self-check, both created through the mutations.
  caller = teacher;
  const a = await createAssignment({ data: { courseId: course.id, title: "Reflection" } });
  assignmentId = a.id;
  const q = await createQuiz({ data: { courseId: course.id, title: "Check", kind: "self_check" } });
  quizId = q.id;
  await createQuestion({ data: { quizId, type: "short_text", promptMd: "What stayed with you?" } });
  await db.insert(s.lessonBlock).values([
    { lessonId: lessons[0]!.id, type: "assignment", payload: { assignment_id: assignmentId } },
    { lessonId: lessons[1]!.id, type: "quiz", payload: { quiz_id: quizId } },
  ]);
});

afterAll(() => {
  vi.useRealTimers();
});

const open = async (user: User, atIso: string) => {
  at(atIso);
  const facts = await loadPersonFacts(user);
  const decisions = decideLessons(facts, course, lessons);
  return lessons.map((l) => decisions.get(l.id)!.ok);
};

describe("a cohort through a dripped course", () => {
  it("the instructor creates the cohort, enrolls three learners and applies the drip rule", async () => {
    caller = teacher;
    const g = await createCohort({
      data: { courseId: course.id, title: "Autumn", startsAt: START, endsAt: null },
    });
    cohortSlug = g.slug;
    const res = await enrollByEmails({
      data: {
        courseId: course.id,
        cohortSlug,
        text: "ana@example.invalid\nbru@example.invalid, cai@example.invalid",
      },
    });
    expect(res.results.map((r) => r.outcome)).toEqual(["invited", "invited", "invited"]);
    const people = await db
      .select()
      .from(s.person)
      .where(eq(s.person.email, "ana@example.invalid"));
    expect(people).toHaveLength(1);
    learners = [];
    for (const email of ["ana", "bru", "cai"]) {
      const [p] = await db
        .select()
        .from(s.person)
        .where(eq(s.person.email, `${email}@example.invalid`));
      learners.push(asUser(p!));
    }
    expect(await applyCohortDrip({ data: { cohortId: g.id, everyDays: 7 } })).toEqual({ count: 3 });
  });

  it("opens one chapter a week, for members only", async () => {
    // The drip opens at local midnight of the deployment zone (Europe/Madrid, UTC+2 in September).
    for (const l of learners)
      expect(await open(l, `${START}T08:00:00Z`)).toEqual([true, false, false]);
    expect(await open(learners[0]!, "2026-09-07T21:00:00Z")).toEqual([true, false, false]);
    expect(await open(learners[0]!, "2026-09-07T22:00:00Z")).toEqual([true, true, false]);
    expect(await open(learners[0]!, "2026-09-14T22:00:00Z")).toEqual([true, true, true]);
    expect(await open(outsider, "2026-09-14T22:00:00Z")).toEqual([false, false, false]);
  });

  it("one learner submits the assignment; the instructor reviews it with a note", async () => {
    at(`${START}T09:00:00Z`);
    caller = learners[1]!;
    await setLessonCompleted({ data: { lessonId: lessons[0]!.id, completed: true } });
    const sub = await submitAssignment({
      data: { assignmentId, textMd: "I noticed my breathing.", fileKey: null },
    });

    // Someone who is not enrolled cannot submit.
    caller = outsider;
    await expect(
      submitAssignment({ data: { assignmentId, textMd: "let me in", fileKey: null } }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    caller = teacher;
    const all = await listSubmissions({ data: { courseSlug: course.slug } });
    expect(all!.submissions.map((x) => x.personName)).toEqual(["bru"]);
    const inCohort = await listSubmissions({ data: { courseSlug: course.slug, cohortSlug } });
    expect(inCohort!.submissions).toHaveLength(1);
    const elsewhere = await listSubmissions({
      data: { courseSlug: course.slug, cohortSlug: "nope" },
    });
    expect(elsewhere!.submissions).toHaveLength(0);

    // A learner cannot review.
    caller = learners[1]!;
    await expect(
      reviewSubmission({ data: { submissionId: sub.id, status: "reviewed", commentMd: "self" } }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    caller = teacher;
    await reviewSubmission({
      data: { submissionId: sub.id, status: "reviewed", commentMd: "Lovely, keep noticing." },
    });
    const [row] = await db.select().from(s.submission).where(eq(s.submission.id, sub.id));
    expect(row).toMatchObject({
      status: "reviewed",
      teacherCommentMd: "Lovely, keep noticing.",
      reviewedBy: teacher.id,
    });
    expect(row!.reviewedAt).toBeInstanceOf(Date);
    const feedback = await db
      .select()
      .from(s.notification)
      .where(
        and(
          eq(s.notification.personId, learners[1]!.id),
          eq(s.notification.kind, "feedback_returned"),
        ),
      );
    expect(feedback).toHaveLength(1);
    const actions = (await db.select().from(s.auditLog)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "cohort.create",
        "enrollment.bulk",
        "cohort.release.drip",
        "submission.create",
        "submission.review",
      ]),
    );
  });

  it("everyone finishes the course as the weeks open; progress is computed, not stored", async () => {
    // Week 1: everybody completes lesson 1.
    at("2026-09-02T09:00:00Z");
    for (const l of learners) {
      caller = l;
      await setLessonCompleted({ data: { lessonId: lessons[0]!.id, completed: true } });
    }
    // Lesson 2 is still locked.
    caller = learners[0]!;
    await expect(
      setLessonCompleted({ data: { lessonId: lessons[1]!.id, completed: true } }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Week 2: the self-check opens; a learner answers it and the lesson completes with it.
    at("2026-09-08T09:00:00Z");
    caller = learners[2]!;
    const attempt = await submitQuizAttempt({
      data: {
        quizId,
        answers: [
          {
            questionId: (await db.select().from(s.question))[0]!.id,
            optionIds: [],
            text: "Silence",
          },
        ],
      },
    });
    expect(attempt).toMatchObject({ ok: true });
    for (const l of [learners[0]!, learners[1]!]) {
      caller = l;
      await setLessonCompleted({ data: { lessonId: lessons[1]!.id, completed: true } });
    }

    // Week 3: the last lesson.
    at("2026-09-15T09:00:00Z");
    for (const l of learners) {
      caller = l;
      await setLessonCompleted({ data: { lessonId: lessons[2]!.id, completed: true } });
    }

    for (const l of learners) {
      const done = await db
        .select()
        .from(s.lessonProgress)
        .where(and(eq(s.lessonProgress.personId, l.id), eq(s.lessonProgress.status, "completed")));
      const progress = courseProgress(
        lessons.map((x) => ({
          id: x.id,
          status: x.status,
          accessible: true,
          completed: done.some((d) => d.lessonId === x.id),
        })),
      );
      expect(progress).toMatchObject({ completed: 3, total: 3, ratio: 1 });
    }
  });
});
