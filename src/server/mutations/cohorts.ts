import { createServerFn } from "@tanstack/react-start";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import {
  COHORT_STATUSES,
  chapter,
  cohort,
  cohortMember,
  cohortRelease,
  enrollment,
  lesson,
  person,
} from "~/db/schema";
import { SLUG_PATTERN, slugify } from "~/lib/slug";
import { audit } from "~/server/audit";
import { requireCourseTeacher } from "~/server/auth/authz";
import { upsertManualEnrollment } from "./enrollments-core";
import { applyDripRule } from "./cohorts-core";

const id = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function courseIdOfCohort(cohortId: string) {
  const [c] = await db
    .select({ courseId: cohort.courseId })
    .from(cohort)
    .where(eq(cohort.id, cohortId))
    .limit(1);
  if (!c) throw new Error("cohort not found");
  return c.courseId;
}

export const createCohort = createServerFn({ method: "POST" })
  .validator(
    z.object({
      courseId: id,
      title: z.string().trim().min(1).max(200),
      startsAt: dateStr.nullable(),
      endsAt: dateStr.nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    return db.transaction(async (tx) => {
      const taken = (await tx.select({ slug: cohort.slug }).from(cohort)).map((r) => r.slug);
      let slug = slugify(data.title) || "cohort";
      for (let n = 2; taken.includes(slug); n++) slug = `${slugify(data.title)}-${n}`;
      const [row] = await tx
        .insert(cohort)
        .values({
          courseId: data.courseId,
          title: data.title,
          slug,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
        })
        .returning();
      // The course's teachers join as cohort teachers so they see the group's page.
      const teachers = await tx.query.courseTeacher.findMany({
        where: (t, { eq: e }) => e(t.courseId, data.courseId),
      });
      if (teachers.length)
        await tx
          .insert(cohortMember)
          .values(
            teachers.map((t) => ({
              cohortId: row!.id,
              personId: t.personId,
              role: "teacher" as const,
            })),
          )
          .onConflictDoNothing();
      await audit(tx, {
        actorId: user.id,
        action: "cohort.create",
        entity: "cohort",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateCohort = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cohortId: id,
      patch: z
        .object({
          title: z.string().trim().min(1).max(200),
          slug: z.string().regex(SLUG_PATTERN),
          startsAt: dateStr.nullable(),
          endsAt: dateStr.nullable(),
          status: z.enum(COHORT_STATUSES),
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfCohort(data.cohortId));
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(cohort).where(eq(cohort.id, data.cohortId)).limit(1);
      if (data.patch.slug && data.patch.slug !== before!.slug) {
        const clash = await tx
          .select({ id: cohort.id })
          .from(cohort)
          .where(and(eq(cohort.slug, data.patch.slug), ne(cohort.id, data.cohortId)))
          .limit(1);
        if (clash[0]) throw new Error("slug already in use");
      }
      const [after] = await tx
        .update(cohort)
        .set(data.patch)
        .where(eq(cohort.id, data.cohortId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "cohort.update",
        entity: "cohort",
        entityId: data.cohortId,
        before,
        after,
      });
      return after!;
    });
  });

export const deleteCohort = createServerFn({ method: "POST" })
  .validator(z.object({ cohortId: id }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfCohort(data.cohortId));
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(cohort).where(eq(cohort.id, data.cohortId)).limit(1);
      await tx.delete(cohort).where(eq(cohort.id, data.cohortId));
      await audit(tx, {
        actorId: user.id,
        action: "cohort.delete",
        entity: "cohort",
        entityId: data.cohortId,
        before,
      });
      return { ok: true };
    });
  });

/**
 * Manual placement by email. A student also gets a `manual` cohort-scoped enrollment, so being in
 * the group opens the course; the enrollment source's cohort-scoped rows place people automatically.
 */
export const addCohortMember = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cohortId: id,
      email: z.string().email(),
      role: z.enum(["student", "teacher"]).default("student"),
    }),
  )
  .handler(async ({ data }) => {
    const courseId = await courseIdOfCohort(data.cohortId);
    const user = await requireCourseTeacher(courseId);
    const [p] = await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.email, data.email.toLowerCase()))
      .limit(1);
    if (!p) throw new Error("no person with that email has signed in yet");
    return db.transaction(async (tx) => {
      await tx
        .insert(cohortMember)
        .values({ cohortId: data.cohortId, personId: p.id, role: data.role })
        .onConflictDoUpdate({
          target: [cohortMember.cohortId, cohortMember.personId],
          set: { role: data.role },
        });
      const enrolled =
        data.role === "student"
          ? await upsertManualEnrollment(tx, {
              personId: p.id,
              courseId,
              cohortId: data.cohortId,
            })
          : null;
      await audit(tx, {
        actorId: user.id,
        action: "cohort.member.add",
        entity: "cohort",
        entityId: data.cohortId,
        after: { personId: p.id, role: data.role, enrollmentId: enrolled?.row.id ?? null },
      });
      return { ok: true };
    });
  });

export const removeCohortMember = createServerFn({ method: "POST" })
  .validator(z.object({ cohortId: id, personId: id }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfCohort(data.cohortId));
    return db.transaction(async (tx) => {
      await tx
        .delete(cohortMember)
        .where(
          and(eq(cohortMember.cohortId, data.cohortId), eq(cohortMember.personId, data.personId)),
        );
      // Only the placement's own `manual` row: synced rows belong to the external system.
      await tx
        .update(enrollment)
        .set({ status: "revoked" })
        .where(
          and(
            eq(enrollment.personId, data.personId),
            eq(enrollment.cohortId, data.cohortId),
            eq(enrollment.source, "manual"),
          ),
        );
      await audit(tx, {
        actorId: user.id,
        action: "cohort.member.remove",
        entity: "cohort",
        entityId: data.cohortId,
        before: { personId: data.personId },
      });
      return { ok: true };
    });
  });

export const addRelease = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        cohortId: id,
        chapterId: id.nullable(),
        lessonId: id.nullable(),
        releaseAt: z.string().datetime({ offset: true }),
      })
      .refine((v) => (v.chapterId === null) !== (v.lessonId === null), "exactly one target"),
  )
  .handler(async ({ data }) => {
    const courseId = await courseIdOfCohort(data.cohortId);
    const user = await requireCourseTeacher(courseId);
    // The target must belong to the cohort's course.
    if (data.chapterId) {
      const [ch] = await db
        .select({ courseId: chapter.courseId })
        .from(chapter)
        .where(eq(chapter.id, data.chapterId))
        .limit(1);
      if (ch?.courseId !== courseId) throw new Error("chapter of another course");
    } else if (data.lessonId) {
      const [l] = await db
        .select({ courseId: chapter.courseId })
        .from(lesson)
        .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
        .where(eq(lesson.id, data.lessonId))
        .limit(1);
      if (l?.courseId !== courseId) throw new Error("lesson of another course");
    }
    return db.transaction(async (tx) => {
      // One schedule row per target: replace an existing one.
      await tx
        .delete(cohortRelease)
        .where(
          and(
            eq(cohortRelease.cohortId, data.cohortId),
            data.chapterId
              ? eq(cohortRelease.chapterId, data.chapterId)
              : eq(cohortRelease.lessonId, data.lessonId!),
          ),
        );
      const [row] = await tx
        .insert(cohortRelease)
        .values({
          cohortId: data.cohortId,
          chapterId: data.chapterId,
          lessonId: data.lessonId,
          releaseAt: new Date(data.releaseAt),
        })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "cohort.release.set",
        entity: "cohort_release",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const deleteRelease = createServerFn({ method: "POST" })
  .validator(z.object({ releaseId: id }))
  .handler(async ({ data }) => {
    const [r] = await db
      .select()
      .from(cohortRelease)
      .where(eq(cohortRelease.id, data.releaseId))
      .limit(1);
    if (!r) throw new Error("release not found");
    const user = await requireCourseTeacher(await courseIdOfCohort(r.cohortId));
    return db.transaction(async (tx) => {
      await tx.delete(cohortRelease).where(eq(cohortRelease.id, r.id));
      await audit(tx, {
        actorId: user.id,
        action: "cohort.release.delete",
        entity: "cohort_release",
        entityId: r.id,
        before: r,
      });
      return { ok: true };
    });
  });

export const applyCohortDrip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cohortId: id,
      everyDays: z.number().int().min(1).max(365),
      chaptersPerStep: z.number().int().min(1).max(50).default(1),
      startDate: dateStr.nullable().default(null),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(await courseIdOfCohort(data.cohortId));
    const rows = await db.transaction((tx) => applyDripRule(tx, user, data));
    return { count: rows.length };
  });
