/**
 * The one place that decides whether a person may open a lesson (CLAUDE.md invariants).
 * Pure: takes every fact as data, including `now`, so the matrix in tests/access.test.ts can be
 * exhaustive. Nothing here knows what an organisation's membership tiers are: the external system
 * sends per-course enrollments with the validity window it wants (ADR-014).
 */
import { dateInZone } from "../../lib/dates.ts";

export interface EnrollmentFact {
  courseSlug: string;
  status: "active" | "expired" | "revoked";
  validFrom: Date;
  /** Exclusive end of access; null means open-ended. */
  validUntil: Date | null;
}

export interface CourseFact {
  slug: string;
  status: "draft" | "published" | "archived";
}

export interface LessonFact {
  id: string;
  chapterId: string;
  status: "draft" | "published";
}

export interface CohortFact {
  slug: string;
  releases: { chapterId: string | null; lessonId: string | null; releaseAt: Date }[];
}

export interface AccessInput {
  now: Date;
  /** Zone used to name the day an expired enrollment ended. */
  timeZone: string;
  course: CourseFact;
  /** Null evaluates course-level access (catalogue, syllabus header). */
  lesson: LessonFact | null;
  enrollments: EnrollmentFact[];
  /** Cohorts of this course the person belongs to (drip applies through them). */
  cohorts: CohortFact[];
  /** Teachers of the course and admins see everything, drafts included. */
  privileged: boolean;
}

export type LockReason =
  | "not_enrolled"
  | "expired"
  | "course_not_published"
  | "lesson_not_published"
  | "not_yet_released";

export type Decision =
  | { ok: true }
  | { ok: false; reason: LockReason; availableAt?: Date; expiredOn?: string };

export function canSeeLesson(input: AccessInput): Decision {
  const { now, timeZone, course, lesson, enrollments, cohorts } = input;

  if (input.privileged) return { ok: true };
  if (course.status === "draft") return { ok: false, reason: "course_not_published" };
  if (lesson && lesson.status !== "published") return { ok: false, reason: "lesson_not_published" };

  // A revoked enrollment is as good as none.
  const mine = enrollments.filter((e) => e.courseSlug === course.slug && e.status !== "revoked");
  if (mine.length === 0) return { ok: false, reason: "not_enrolled" };

  const ended = (e: EnrollmentFact) =>
    e.status === "expired" || (e.validUntil !== null && e.validUntil <= now);
  const live = mine.filter((e) => !ended(e) && e.validFrom <= now);
  if (live.length === 0) {
    // A renewal that has not started yet is more useful to show than the lapse before it.
    const upcoming = mine.filter((e) => !ended(e)).map((e) => e.validFrom);
    if (upcoming.length) {
      const availableAt = upcoming.reduce((a, b) => (a < b ? a : b));
      return { ok: false, reason: "not_yet_released", availableAt };
    }
    const last = mine
      .map((e) => e.validUntil)
      .filter((d): d is Date => d !== null)
      .reduce<Date>((a, b) => (a > b ? a : b), new Date(0));
    return {
      ok: false,
      reason: "expired",
      expiredOn: dateInZone(last.getTime() === 0 ? now : last, timeZone),
    };
  }

  // Cohort drip: a scheduled lesson (or its chapter) opens at its release instant; a lesson-level
  // row overrides the chapter's. Unscheduled lessons follow the enrollment alone. With several
  // cohorts, the earliest schedule applies.
  if (lesson && cohorts.length > 0) {
    let drip: Date | null = null;
    for (const c of cohorts) {
      const forLesson = c.releases.find((r) => r.lessonId === lesson.id);
      const forChapter = c.releases.find((r) => r.chapterId === lesson.chapterId);
      const at = (forLesson ?? forChapter)?.releaseAt ?? new Date(0);
      if (drip === null || at < drip) drip = at;
    }
    if (drip && drip > now) return { ok: false, reason: "not_yet_released", availableAt: drip };
  }

  return { ok: true };
}

/** Course-level enrollment, ignoring release timing: what the catalogue lists. */
export function isEnrolled(input: Omit<AccessInput, "lesson">): boolean {
  const d = canSeeLesson({ ...input, lesson: null });
  return d.ok || d.reason === "not_yet_released";
}
