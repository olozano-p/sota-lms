/**
 * The `manual` enrollment writes behind `enrollments.ts`. Kept apart from the server functions so
 * that nothing server-only is reachable from the client bundle through a plain export; callers
 * authorise the actor and own the transaction (CLAUDE.md invariants).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type DbOrTx } from "~/db";
import { cohort, cohortMember, enrollment, person } from "~/db/schema";
import { parseEmailList } from "~/lib/emails";
import { audit, enrollmentChange, enrollmentDetail, type EnrollmentChange } from "~/server/audit";
import type { SessionUser } from "~/server/auth/authz";
import { createInvitation } from "./people-core";

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

export const MAX_BULK_EMAILS = 500;

const countBy = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

export type BulkOutcome = "enrolled" | "already" | "invited" | "placeholder";

type Actor = Pick<SessionUser, "id" | "name">;
export type Window = { validFrom?: Date; validUntil?: Date | null };

/** A manual row that is already active and open-ended in the same window needs no write. */
const isUnchanged = (
  before: { status: string; validFrom: Date; validUntil: Date | null } | null,
  w: Window,
) =>
  before !== null &&
  before.status === "active" &&
  (w.validFrom === undefined || before.validFrom.getTime() === w.validFrom.getTime()) &&
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
        .where(inArray(sql<string>`lower(${person.email})`, emails))
    : [];
  const idOf = new Map(known.map((p) => [p.email.toLowerCase(), p.id]));
  const results: { email: string; outcome: BulkOutcome }[] = [];
  const changes: EnrollmentChange[] = [];
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
    const { before, row } = await upsertManualEnrollment(tx, {
      personId,
      courseId: input.courseId,
      cohortId: input.cohortId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });
    const outcome = created ?? (isUnchanged(before, input) ? "already" : "enrolled");
    results.push({ email, outcome });
    changes.push(
      enrollmentChange(before, row, outcome === "already" ? "unchanged" : undefined, {
        email,
        outcome,
      }),
    );
  }
  await audit(tx, {
    actorId: actor.id,
    action: "enrollment.bulk",
    entity: "course",
    entityId: input.courseId,
    after: enrollmentDetail(changes, {
      cohortId: input.cohortId,
      requested: emails.length,
      outcomes: countBy(results.map((r) => r.outcome)),
      invalid: invalid.slice(0, 50),
    }),
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
  const changes: EnrollmentChange[] = [];
  for (const m of members) {
    const { before, row } = await upsertManualEnrollment(tx, {
      personId: m.personId,
      courseId: input.targetCourseId,
      cohortId: scope,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });
    changes.push(enrollmentChange(before, row));
  }
  await audit(tx, {
    actorId: actor.id,
    action: "enrollment.cohort",
    entity: "cohort",
    entityId: input.cohortId,
    after: enrollmentDetail(changes, {
      targetCourseId: input.targetCourseId,
      scoped: scope !== null,
      count: members.length,
    }),
  });
  return { enrolled: members.length };
}
