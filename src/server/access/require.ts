/**
 * Loads the facts `canSeeLesson` needs and applies it. Content loaders call `requireLessonAccess`;
 * the syllabus and catalogue call `decideLessons` / `enrolledCourses`. Server-only.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import {
  chapter,
  cohort,
  cohortMember,
  cohortRelease,
  course,
  courseTeacher,
  enrollment,
  lesson,
} from "~/db/schema";
import { lmsConfig } from "~/config";
import { now as clock } from "~/lib/dates";
import { AuthorizationError, hasRole, type SessionUser } from "~/server/auth/authz";
import { ensureFreshEnrollments } from "./enrollments";
import {
  canSeeLesson,
  isEnrolled,
  type CohortFact,
  type Decision,
  type EnrollmentFact,
} from "./rules";

export interface PersonAccessFacts {
  enrollments: EnrollmentFact[];
  /** Cohorts the person belongs to, with their drip schedule, keyed by course id. */
  cohortsByCourse: Map<string, CohortFact[]>;
  teacherOf: Set<string>;
  admin: boolean;
}

export async function loadPersonFacts(user: SessionUser): Promise<PersonAccessFacts> {
  await ensureFreshEnrollments(user.id);
  const [enrolled, memberships, teaching] = await Promise.all([
    db
      .select({
        courseSlug: course.slug,
        status: enrollment.status,
        validFrom: enrollment.validFrom,
        validUntil: enrollment.validUntil,
      })
      .from(enrollment)
      .innerJoin(course, eq(course.id, enrollment.courseId))
      .where(eq(enrollment.personId, user.id)),
    db
      .select({ id: cohort.id, slug: cohort.slug, courseId: cohort.courseId })
      .from(cohortMember)
      .innerJoin(cohort, eq(cohort.id, cohortMember.cohortId))
      .where(eq(cohortMember.personId, user.id)),
    db
      .select({ courseId: courseTeacher.courseId })
      .from(courseTeacher)
      .where(eq(courseTeacher.personId, user.id)),
  ]);
  const releases = memberships.length
    ? await db
        .select({
          cohortId: cohortRelease.cohortId,
          chapterId: cohortRelease.chapterId,
          lessonId: cohortRelease.lessonId,
          releaseAt: cohortRelease.releaseAt,
        })
        .from(cohortRelease)
        .where(
          inArray(
            cohortRelease.cohortId,
            memberships.map((m) => m.id),
          ),
        )
    : [];
  const cohortsByCourse = new Map<string, CohortFact[]>();
  for (const m of memberships) {
    const list = cohortsByCourse.get(m.courseId) ?? [];
    list.push({ slug: m.slug, releases: releases.filter((r) => r.cohortId === m.id) });
    cohortsByCourse.set(m.courseId, list);
  }
  return {
    enrollments: enrolled,
    cohortsByCourse,
    teacherOf: new Set(teaching.map((t) => t.courseId)),
    admin: hasRole(user, "admin"),
  };
}

type CourseRow = {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
};

function baseInput(facts: PersonAccessFacts, c: CourseRow, at: Date) {
  return {
    now: at,
    timeZone: lmsConfig.timeZone,
    course: { slug: c.slug, status: c.status },
    enrollments: facts.enrollments,
    cohorts: facts.cohortsByCourse.get(c.id) ?? [],
    privileged: facts.admin || facts.teacherOf.has(c.id),
  };
}

/** Courses the person may see in the catalogue (enrolled, or teaching). */
export function enrolledCourses<T extends CourseRow>(
  facts: PersonAccessFacts,
  courses: T[],
  at = clock(),
): T[] {
  return courses.filter((c) => isEnrolled(baseInput(facts, c, at)));
}

/** One decision per lesson of a course; the syllabus paints lock states from it. */
export function decideLessons(
  facts: PersonAccessFacts,
  c: CourseRow,
  lessons: { id: string; chapterId: string; status: "draft" | "published" }[],
  at = clock(),
): Map<string, Decision> {
  const base = baseInput(facts, c, at);
  return new Map(lessons.map((l) => [l.id, canSeeLesson({ ...base, lesson: l })]));
}

export function decideCourse(facts: PersonAccessFacts, c: CourseRow, at = clock()): Decision {
  return canSeeLesson({ ...baseInput(facts, c, at), lesson: null });
}

export function isPrivileged(facts: PersonAccessFacts, courseId: string): boolean {
  return facts.admin || facts.teacherOf.has(courseId);
}

/** Throws 403 unless the person may open the lesson right now. Returns the rows it loaded. */
export async function requireLessonAccess(user: SessionUser, lessonId: string) {
  const rows = await db
    .select({ lesson, chapter, course })
    .from(lesson)
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .innerJoin(course, eq(course.id, chapter.courseId))
    .where(and(eq(lesson.id, lessonId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AuthorizationError(403);
  const facts = await loadPersonFacts(user);
  const decision = canSeeLesson({
    ...baseInput(facts, row.course, clock()),
    lesson: { id: row.lesson.id, chapterId: row.lesson.chapterId, status: row.lesson.status },
  });
  if (!decision.ok) throw new AuthorizationError(403);
  return { ...row, facts };
}
