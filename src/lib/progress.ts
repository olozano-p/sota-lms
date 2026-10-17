/** Course progress is computed, never stored (docs/spec.md §4). */

export interface LessonForProgress {
  id: string;
  status: "draft" | "published";
  /** Open right now for this person. */
  accessible: boolean;
  completed: boolean;
}

export interface CourseProgress {
  completed: number;
  total: number;
  /** 0–1 */
  ratio: number;
}

export function courseProgress(lessons: LessonForProgress[]): CourseProgress {
  const published = lessons.filter((l) => l.status === "published");
  const completed = published.filter((l) => l.completed).length;
  return {
    completed,
    total: published.length,
    ratio: published.length ? completed / published.length : 0,
  };
}

/** The "Continue" target: first published, accessible, not-yet-completed lesson in order; else the last accessible one. */
export function continueTarget<T extends LessonForProgress>(lessonsInOrder: T[]): T | null {
  const candidates = lessonsInOrder.filter((l) => l.status === "published" && l.accessible);
  return candidates.find((l) => !l.completed) ?? candidates.at(-1) ?? null;
}

export type CourseState = "not_started" | "in_progress" | "finished" | "locked";

/**
 * Where a course stands for one person, for the «In progress» / «Finished» split of the course
 * list: every published lesson done, or access that has run out, is finished; a course that does
 * not open (yet) is locked; otherwise any progress at all makes it in progress.
 */
export function courseState(
  progress: CourseProgress,
  access: { ok: boolean; reason?: string },
  started: boolean,
): CourseState {
  if (!access.ok && access.reason === "expired") return "finished";
  if (progress.total > 0 && progress.completed === progress.total) return "finished";
  if (!access.ok) return "locked";
  return started ? "in_progress" : "not_started";
}

/** 1-based position of a chapter among the chapters that hold lessons, in course order. */
export function chapterPosition(
  chapterIdsInOrder: string[],
  chapterId: string,
): { index: number; total: number } | null {
  const distinct = [...new Set(chapterIdsInOrder)];
  const i = distinct.indexOf(chapterId);
  return i < 0 ? null : { index: i + 1, total: distinct.length };
}

/**
 * When a chapter opens: the earliest release date if every lesson in it waits for one, else null.
 * A chapter with any open lesson, or locked for another reason, has no date to show.
 */
export function chapterRelease(
  decisions: { ok: boolean; reason?: string; availableAt?: Date }[],
): Date | null {
  if (!decisions.length) return null;
  let first: Date | null = null;
  for (const d of decisions) {
    if (d.ok || d.reason !== "not_yet_released" || !d.availableAt) return null;
    if (!first || d.availableAt < first) first = d.availableAt;
  }
  return first;
}
