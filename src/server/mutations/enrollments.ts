/** Admin enrollments: `source = 'manual'` rows that the external sync never touches (ADR-014). */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import { cohort, cohortMember, course, enrollment, person } from "~/db/schema";
import { lmsConfig } from "~/config";
import { addDays, DATE_PATTERN, zonedMidnight } from "~/lib/dates";
import { audit } from "~/server/audit";
import { requireRole } from "~/server/auth/authz";
import { syncEnrollments } from "~/server/access/enrollments";

const day = z.string().regex(DATE_PATTERN);

const grantSchema = z.object({
  personId: z.string().uuid(),
  courseSlug: z.string().trim().min(1),
  cohortSlug: z.string().trim().min(1).nullable().optional(),
  /** First day of access (deployment zone); defaults to now. */
  validFrom: day.nullable().optional(),
  /** Inclusive last day of access (deployment zone); null is open-ended. */
  validUntil: day.nullable().optional(),
});

/**
 * Creates or renews the person's `manual` enrollment for a course (and cohort). Callers are
 * mutations that already authorised the actor and own the transaction and the audit row.
 */
export async function upsertManualEnrollment(
  tx: DbOrTx,
  input: {
    personId: string;
    courseId: string;
    cohortId: string | null;
    validFrom?: Date;
    validUntil?: Date | null;
  },
) {
  const [existing] = await tx
    .select()
    .from(enrollment)
    .where(
      and(
        eq(enrollment.personId, input.personId),
        eq(enrollment.courseId, input.courseId),
        input.cohortId ? eq(enrollment.cohortId, input.cohortId) : isNull(enrollment.cohortId),
        eq(enrollment.source, "manual"),
      ),
    )
    .limit(1);
  const values = {
    status: "active" as const,
    validFrom: input.validFrom ?? existing?.validFrom ?? new Date(),
    validUntil: input.validUntil === undefined ? (existing?.validUntil ?? null) : input.validUntil,
  };
  if (existing) {
    const [row] = await tx
      .update(enrollment)
      .set(values)
      .where(eq(enrollment.id, existing.id))
      .returning();
    return { before: existing, row: row! };
  }
  const [row] = await tx
    .insert(enrollment)
    .values({
      personId: input.personId,
      courseId: input.courseId,
      cohortId: input.cohortId,
      source: "manual",
      ...values,
    })
    .returning();
  return { before: null, row: row! };
}

export const grantEnrollment = createServerFn({ method: "POST" })
  .validator(grantSchema)
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    return db.transaction(async (tx) => {
      const [c] = await tx
        .select({ id: course.id })
        .from(course)
        .where(eq(course.slug, data.courseSlug))
        .limit(1);
      if (!c) throw new Error("course not found");
      let cohortId: string | null = null;
      if (data.cohortSlug) {
        const [g] = await tx
          .select({ id: cohort.id, courseId: cohort.courseId })
          .from(cohort)
          .where(eq(cohort.slug, data.cohortSlug))
          .limit(1);
        if (!g || g.courseId !== c.id) throw new Error("cohort not found in that course");
        cohortId = g.id;
        await tx
          .insert(cohortMember)
          .values({ cohortId, personId: data.personId, role: "student" })
          .onConflictDoNothing();
      }
      const tz = lmsConfig.timeZone;
      const { before, row } = await upsertManualEnrollment(tx, {
        personId: data.personId,
        courseId: c.id,
        cohortId,
        validFrom: data.validFrom ? zonedMidnight(data.validFrom, tz) : undefined,
        validUntil:
          data.validUntil === undefined
            ? undefined
            : data.validUntil === null
              ? null
              : zonedMidnight(addDays(data.validUntil, 1), tz),
      });
      await audit(tx, {
        actorId: admin.id,
        action: "enrollment.grant",
        entity: "enrollment",
        entityId: row.id,
        before,
        after: row,
      });
      return row;
    });
  });

/** Marks a `manual` enrollment revoked (the row stays for the history). */
export const revokeEnrollment = createServerFn({ method: "POST" })
  .validator(z.object({ enrollmentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(enrollment)
        .where(and(eq(enrollment.id, data.enrollmentId), eq(enrollment.source, "manual")))
        .limit(1);
      if (!row) throw new Error("only manual enrollments can be revoked here");
      const [after] = await tx
        .update(enrollment)
        .set({ status: "revoked" })
        .where(eq(enrollment.id, row.id))
        .returning();
      await audit(tx, {
        actorId: admin.id,
        action: "enrollment.revoke",
        entity: "enrollment",
        entityId: row.id,
        before: row,
        after,
      });
      return { ok: true };
    });
  });

/** Pull from the enrollment source now instead of waiting for the TTL. */
export const resyncPerson = createServerFn({ method: "POST" })
  .validator(z.object({ personId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    const [p] = await db
      .select({ sub: person.externalSub })
      .from(person)
      .where(eq(person.id, data.personId))
      .limit(1);
    if (!p) throw new Error("person not found");
    // People who exist only locally have no key at the enrollment source.
    const result = p.sub ? await syncEnrollments(p.sub) : null;
    await audit(db, {
      actorId: admin.id,
      action: "enrollment.resync",
      entity: "person",
      entityId: data.personId,
      after: { found: result !== null },
    });
    return { found: result !== null };
  });
