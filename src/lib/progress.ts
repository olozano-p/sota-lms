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
