/**
 * The one place that decides whether a person may open a lesson (CLAUDE.md invariants).
 * Pure: takes every fact as data, including `now`, so the matrix in tests/access.test.ts can be
 * exhaustive. Nothing here knows what an organisation's membership tiers are — only rule *types*.
 */
import type { AccessRule } from "../../config/schema.ts";
import { dateInZone, zonedMidnight } from "../../lib/dates.ts";

export interface EntitlementFact {
  scope: "course" | "all_courses" | "cohort";
  ref: string | null;
  /** Key into `rules`. Unknown keys are treated as "no access" and reported. */
  rule: string;
  /** Inclusive last day of access, `YYYY-MM-DD`, or null. */
  until: string | null;
}

export interface CourseFact {
  slug: string;
  status: "draft" | "published" | "archived";
  endedAt: string | null;
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
  timeZone: string;
  rules: Record<string, AccessRule>;
  course: CourseFact;
  /** Null evaluates course-level access (catalogue, syllabus header). */
  lesson: LessonFact | null;
  entitlements: EntitlementFact[];
  /** Cohorts of this course the person belongs to (drip applies through them). */
  cohorts: CohortFact[];
  /** Teachers of the course and admins see everything, drafts included. */
  privileged: boolean;
}

export type LockReason =
  | "not_entitled"
  | "expired"
  | "course_not_published"
  | "lesson_not_published"
  | "not_yet_released"
  | "awaiting_course_end"
  | "unknown_rule";

export type Decision =
  | { ok: true }
  | { ok: false; reason: LockReason; availableAt?: Date; expiredOn?: string };

/** When a rule instance lets its holder in; `null` means "not until something else happens". */
function availabilityOf(rule: AccessRule, course: CourseFact, timeZone: string): Date | null {
  switch (rule.type) {
    case "immediate":
      return new Date(0);
    case "fixed_date":
      return zonedMidnight(rule.date, timeZone);
    case "delayed_after_course_end": {
      if (!course.endedAt) return null;
      const end = zonedMidnight(course.endedAt, timeZone);
      return new Date(end.getTime() + rule.days * 86_400_000);
    }
  }
}

function matches(e: EntitlementFact, course: CourseFact, cohortSlugs: Set<string>): boolean {
  if (e.scope === "all_courses") return true;
  if (e.scope === "course") return e.ref === course.slug;
  return e.ref !== null && cohortSlugs.has(e.ref);
}

export function canSeeLesson(input: AccessInput): Decision {
  const { now, timeZone, rules, course, lesson, entitlements, cohorts } = input;

  if (input.privileged) return { ok: true };
  if (course.status === "draft") return { ok: false, reason: "course_not_published" };
  if (lesson && lesson.status !== "published") return { ok: false, reason: "lesson_not_published" };

  const cohortSlugs = new Set(cohorts.map((c) => c.slug));
  const today = dateInZone(now, timeZone);
  const matching = entitlements.filter((e) => matches(e, course, cohortSlugs));
  if (matching.length === 0) return { ok: false, reason: "not_entitled" };

  const live = matching.filter((e) => e.until === null || e.until >= today);
  if (live.length === 0) {
    const last = matching
      .map((e) => e.until!)
      .sort()
      .at(-1)!;
    return { ok: false, reason: "expired", expiredOn: last };
  }

  // The best entitlement wins: the earliest availability across the live ones.
  let best: Date | null = null;
  let sawUnknownRule = false;
  let sawAwaitingEnd = false;
  for (const e of live) {
    const rule = rules[e.rule];
    if (!rule) {
      sawUnknownRule = true;
      continue;
    }
    const at = availabilityOf(rule, course, timeZone);
    if (at === null) {
      sawAwaitingEnd = true;
      continue;
    }
    if (best === null || at < best) best = at;
  }
  if (best === null) {
    if (sawAwaitingEnd) return { ok: false, reason: "awaiting_course_end" };
    if (sawUnknownRule) return { ok: false, reason: "unknown_rule" };
    return { ok: false, reason: "not_entitled" };
  }

  // Cohort drip: a scheduled lesson (or its chapter) opens at its release instant; a lesson-level
  // row overrides the chapter's. Unscheduled lessons follow the entitlement alone. With several
  // cohorts, the earliest schedule applies.
  if (lesson && cohorts.length > 0) {
    let drip: Date | null = null;
    for (const c of cohorts) {
      const forLesson = c.releases.find((r) => r.lessonId === lesson.id);
      const forChapter = c.releases.find((r) => r.chapterId === lesson.chapterId);
      const at = (forLesson ?? forChapter)?.releaseAt ?? new Date(0);
      if (drip === null || at < drip) drip = at;
    }
    if (drip && drip > best) best = drip;
  }

  if (best > now) return { ok: false, reason: "not_yet_released", availableAt: best };
  return { ok: true };
}

/** Course-level entitlement, ignoring release timing: what the catalogue lists. */
export function isEntitled(input: Omit<AccessInput, "lesson">): boolean {
  const d = canSeeLesson({ ...input, lesson: null });
  return d.ok || d.reason === "not_yet_released" || d.reason === "awaiting_course_end";
}
