/** Admin enrollments: `source = 'manual'` rows that the external sync never touches (ADR-014). */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import { cohort, cohortMember, course, enrollment, person } from "~/db/schema";
import { lmsConfig } from "~/config";
import { env } from "~/config/env";
import { addDays, DATE_PATTERN, zonedMidnight } from "~/lib/dates";
import { parseEmailList } from "~/lib/emails";
import { audit } from "~/server/audit";
import { requireCourseTeacher, requireRole, type SessionUser } from "~/server/auth/authz";
import { syncEnrollments } from "~/server/access/enrollments";
import { sendImmediate } from "~/server/services/notifications";
import { createInvitation } from "./people";

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

// ---------- Bulk enrollment ----------

export const MAX_BULK_EMAILS = 500;

export type BulkOutcome = "enrolled" | "already" | "invited" | "placeholder";

type Actor = Pick<SessionUser, "id" | "name">;
type Window = { validFrom?: Date; validUntil?: Date | null };

/** A manual row that is already active and open-ended in the same window needs no write. */
const isUnchanged = (before: { status: string; validUntil: Date | null } | null, w: Window) =>
  before !== null &&
  before.status === "active" &&
  (w.validUntil === undefined || before.validUntil?.getTime() === w.validUntil?.getTime());

/**
 * Enrolls every address of a pasted list in a course (and cohort). Callers authorise the actor and
 * own the transaction. An address with no person yet gets, in `local` mode, a student account
 * created through an invitation (the mail is queued; the caller flushes it after commit) and, in
 * `oidc` mode, a placeholder `person` with no `external_sub`: the first OIDC sign-in with that
 * email adopts it, so the enrollment is waiting for them (ADR-016). The placeholder is inert until
 * then: it has no credential and no session.
 */
export async function enrollEmails(
  tx: DbOrTx,
  actor: Actor,
  input: {
    authMode: "local" | "oidc";
    courseId: string;
    cohortId: string | null;
    text: string;
  } & Window,
): Promise<{ results: { email: string; outcome: BulkOutcome }[]; invalid: string[] }> {
  const { emails, invalid } = parseEmailList(input.text);
  if (emails.length > MAX_BULK_EMAILS) throw new Error(`at most ${MAX_BULK_EMAILS} addresses`);
  const known = emails.length
    ? await tx
        .select({ id: person.id, email: person.email })
        .from(person)
        .where(inArray(person.email, emails))
    : [];
  const idOf = new Map(known.map((p) => [p.email, p.id]));
  const results: { email: string; outcome: BulkOutcome }[] = [];
  for (const email of emails) {
    let personId = idOf.get(email);
    let created: BulkOutcome | null = null;
    if (!personId) {
      if (input.authMode === "local") {
        const inv = await createInvitation(tx, actor, {
          email,
          name: email.split("@")[0]!,
          roles: ["student"],
          locale: null,
        });
        personId = inv.personId;
        created = "invited";
      } else {
        const [p] = await tx
          .insert(person)
          .values({ email, name: email, roles: ["student"] })
          .returning({ id: person.id });
        personId = p!.id;
        created = "placeholder";
      }
    }
    if (input.cohortId)
      await tx
        .insert(cohortMember)
        .values({ cohortId: input.cohortId, personId, role: "student" })
        .onConflictDoNothing();
    const { before } = await upsertManualEnrollment(tx, {
      personId,
      courseId: input.courseId,
      cohortId: input.cohortId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });
    results.push({
      email,
      outcome: created ?? (isUnchanged(before, input) ? "already" : "enrolled"),
    });
  }
  await audit(tx, {
    actorId: actor.id,
    action: "enrollment.bulk",
    entity: "course",
    entityId: input.courseId,
    after: { cohortId: input.cohortId, results, invalid },
  });
  return { results, invalid };
}

/**
 * Enrolls the students of a cohort in `targetCourseId`: cohort-scoped when that is the cohort's own
 * course (it repairs members placed without a row), course-wide in any other course. Teachers of
 * the cohort are skipped.
 */
export async function enrollCohortMembers(
  tx: DbOrTx,
  actor: Actor,
  input: { cohortId: string; targetCourseId: string } & Window,
): Promise<{ enrolled: number }> {
  const [g] = await tx
    .select({ courseId: cohort.courseId })
    .from(cohort)
    .where(eq(cohort.id, input.cohortId))
    .limit(1);
  if (!g) throw new Error("cohort not found");
  const members = await tx
    .select({ personId: cohortMember.personId })
    .from(cohortMember)
    .where(and(eq(cohortMember.cohortId, input.cohortId), eq(cohortMember.role, "student")));
  const scope = g.courseId === input.targetCourseId ? input.cohortId : null;
  for (const m of members)
    await upsertManualEnrollment(tx, {
      personId: m.personId,
      courseId: input.targetCourseId,
      cohortId: scope,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });
  await audit(tx, {
    actorId: actor.id,
    action: "enrollment.cohort",
    entity: "cohort",
    entityId: input.cohortId,
    after: { targetCourseId: input.targetCourseId, scoped: scope !== null, count: members.length },
  });
  return { enrolled: members.length };
}

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
