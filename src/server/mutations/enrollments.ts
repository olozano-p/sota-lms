/** Admin enrollments: `source = 'manual'` rows that the external sync never touches (ADR-014). */
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import { cohort, cohortMember, course, enrollment, person } from "~/db/schema";
import { lmsConfig } from "~/config";
import { env } from "~/config/env";
import { addDays, DATE_PATTERN, zonedMidnight } from "~/lib/dates";
import { audit } from "~/server/audit";
import { requireCourseTeacher, requireRole } from "~/server/auth/authz";
import { syncEnrollments } from "~/server/access/enrollments";
import { sendImmediate } from "~/server/services/notifications";
import {
  enrollCohortMembers,
  enrollEmails,
  upsertManualEnrollment,
  type Window,
} from "./enrollments-core";

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

// ---------- Bulk enrollment ----------

const windowSchema = {
  validFrom: day.nullable().optional(),
  validUntil: day.nullable().optional(),
};

function toWindow(data: { validFrom?: string | null; validUntil?: string | null }): Window {
  const tz = lmsConfig.timeZone;
  return {
    validFrom: data.validFrom ? zonedMidnight(data.validFrom, tz) : undefined,
    validUntil:
      data.validUntil === undefined
        ? undefined
        : data.validUntil === null
          ? null
          : zonedMidnight(addDays(data.validUntil, 1), tz),
  };
}

async function cohortOfCourse(tx: DbOrTx, courseId: string, cohortSlug: string | null | undefined) {
  if (!cohortSlug) return null;
  const [g] = await tx
    .select({ id: cohort.id })
    .from(cohort)
    .where(and(eq(cohort.slug, cohortSlug), eq(cohort.courseId, courseId)))
    .limit(1);
  if (!g) throw new Error("cohort not found in that course");
  return g.id;
}

/** One address or a pasted list. Admins and the course's teachers. */
export const enrollByEmails = createServerFn({ method: "POST" })
  .validator(
    z.object({
      courseId: z.string().uuid(),
      cohortSlug: z.string().trim().min(1).nullable().optional(),
      text: z.string().max(100_000),
      ...windowSchema,
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    const result = await db.transaction(async (tx) =>
      enrollEmails(tx, user, {
        authMode: env.authMode,
        courseId: data.courseId,
        cohortId: await cohortOfCourse(tx, data.courseId, data.cohortSlug),
        text: data.text,
        ...toWindow(data),
      }),
    );
    // Invitation mail is queued in the transaction; flush it now that it has committed.
    sendImmediate().catch((e) => console.warn("invitation mail failed:", (e as Error).message));
    return result;
  });

/** Enrolls a cohort's students in a course; the actor must teach both the cohort's and the target course. */
export const enrollCohort = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cohortId: z.string().uuid(),
      targetCourseId: z.string().uuid().optional(),
      ...windowSchema,
    }),
  )
  .handler(async ({ data }) => {
    const [g] = await db
      .select({ courseId: cohort.courseId })
      .from(cohort)
      .where(eq(cohort.id, data.cohortId))
      .limit(1);
    if (!g) throw new Error("cohort not found");
    const user = await requireCourseTeacher(g.courseId);
    const target = data.targetCourseId ?? g.courseId;
    if (target !== g.courseId) await requireCourseTeacher(target);
    return db.transaction((tx) =>
      enrollCohortMembers(tx, user, {
        cohortId: data.cohortId,
        targetCourseId: target,
        ...toWindow(data),
      }),
    );
  });
