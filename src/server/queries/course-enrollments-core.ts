/** The read behind the course enrollments tab; the server function lives in `enrollments.ts`. */
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { cohort, enrollment, person } from "~/db/schema";

export const COURSE_ENROLLMENTS_LIMIT = 500;

/**
 * Every enrollment of a course with its origin: `source` (manual, claims, webhook), the external
 * system's `externalId` and whether the person has not signed in yet (`pending`: a placeholder or
 * an invitation waiting for them). Newest first; `total` counts beyond the limit.
 */
export async function courseEnrollmentRows(courseId: string) {
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: enrollment.id,
        personId: person.id,
        name: person.name,
        email: person.email,
        sub: person.externalSub,
        pending: sql<boolean>`${person.lastSeenAt} is null`,
        cohortTitle: cohort.title,
        source: enrollment.source,
        externalId: enrollment.externalId,
        status: enrollment.status,
        validFrom: enrollment.validFrom,
        validUntil: enrollment.validUntil,
      })
      .from(enrollment)
      .innerJoin(person, eq(person.id, enrollment.personId))
      .leftJoin(cohort, eq(cohort.id, enrollment.cohortId))
      .where(eq(enrollment.courseId, courseId))
      .orderBy(desc(enrollment.createdAt), asc(person.name))
      .limit(COURSE_ENROLLMENTS_LIMIT),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(enrollment)
      .where(eq(enrollment.courseId, courseId)),
  ]);
  return { rows, total: count?.n ?? rows.length };
}
