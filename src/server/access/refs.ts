/**
 * Resolves the course and cohort references an external system sends. A reference is a slug or the
 * `external_ref` an admin set; a slug wins when both would match. Plain-Node safe.
 */
import { inArray, or } from "drizzle-orm";
import type { DbOrTx } from "../../db/index.ts";
import { cohort, course } from "../../db/schema.ts";

export interface RefIndex {
  course: (ref: string) => { id: string } | null;
  cohort: (ref: string) => { id: string; courseId: string } | null;
}

export async function loadRefs(
  tx: DbOrTx,
  items: { course: string; cohort?: string | null }[],
): Promise<RefIndex> {
  const courseRefs = [...new Set(items.map((i) => i.course))];
  const cohortRefs = [...new Set(items.flatMap((i) => (i.cohort ? [i.cohort] : [])))];
  const courses = courseRefs.length
    ? await tx
        .select({ id: course.id, slug: course.slug, ref: course.externalRef })
        .from(course)
        .where(or(inArray(course.slug, courseRefs), inArray(course.externalRef, courseRefs)))
    : [];
  const cohorts = cohortRefs.length
    ? await tx
        .select({
          id: cohort.id,
          slug: cohort.slug,
          ref: cohort.externalRef,
          courseId: cohort.courseId,
        })
        .from(cohort)
        .where(or(inArray(cohort.slug, cohortRefs), inArray(cohort.externalRef, cohortRefs)))
    : [];
  const pick = <T extends { slug: string; ref: string | null }>(rows: T[], ref: string) =>
    rows.find((r) => r.slug === ref) ?? rows.find((r) => r.ref === ref) ?? null;
  return {
    course: (ref) => pick(courses, ref),
    cohort: (ref) => pick(cohorts, ref),
  };
}
