/**
 * The writes behind the service API (`PUT`/`DELETE /api/v1/enrollments/{external_id}`,
 * docs/integration.md). They create `webhook` enrollments keyed by `external_id` and, in `oidc`
 * mode, placeholder people, and never read or change a `manual` or `claims` row (ADR-014, ADR-020).
 * Each call proves the actor with a `ServiceActor` (see `requireService`), owns its transaction
 * and ends with an `audit_log` row whose actor is `service:api`. Not a server function: nothing
 * here is reachable from the client bundle.
 */
import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "~/db";
import {
  cohort,
  cohortMember,
  course,
  enrollment,
  person,
  type EnrollmentStatus,
} from "~/db/schema";
import { env } from "~/config/env";
import { loadRefs } from "~/server/access/refs";
import { audit } from "~/server/audit";
import type { ServiceActor } from "~/server/auth/service";

export const SERVICE_ACTOR_LABEL = "service:api";
/** Reserved TLD: a placeholder keyed only by `sub` has no address until the person signs in. */
const PLACEHOLDER_DOMAIN = "placeholder.invalid";

export class ServiceApiError extends Error {
  constructor(
    public readonly status: 404 | 409 | 422,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertService(actor: ServiceActor): void {
  if (actor?.kind !== "service") throw new Error("a service actor is required");
}

export interface PutEnrollmentInput {
  externalId: string;
  user: { sub?: string; email?: string; name?: string };
  /** Slug or `external_ref`. */
  course: string;
  cohort?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
}

export interface EnrollmentView {
  externalId: string;
  course: { slug: string; externalRef: string | null };
  cohort: { slug: string; externalRef: string | null } | null;
  user: { sub: string | null; email: string; pending: boolean };
  status: EnrollmentStatus;
  validFrom: Date;
  validUntil: Date | null;
}

export interface PutEnrollmentResult {
  enrollment: EnrollmentView;
  created: boolean;
  changed: boolean;
}

const placeholderEmail = (sub: string) =>
  `u-${createHash("sha256").update(sub).digest("hex").slice(0, 24)}@${PLACEHOLDER_DOMAIN}`;

type PersonRow = typeof person.$inferSelect;

/**
 * Finds the person by `sub`, else by email (adopting the sub when the person has none); creates a
 * placeholder in `oidc` mode (the first sign-in adopts it: by email through account linking, by
 * `sub` through `adoptSubPlaceholder`). In `local` mode an unknown person is a 404: the service
 * cannot register anyone there.
 */
async function resolvePerson(
  tx: DbOrTx,
  user: PutEnrollmentInput["user"],
): Promise<{ row: PersonRow; createdPerson: boolean }> {
  const email = user.email?.toLowerCase();
  if (user.sub) {
    const [bySub] = await tx.select().from(person).where(eq(person.externalSub, user.sub)).limit(1);
    if (bySub) return { row: bySub, createdPerson: false };
  }
  if (email) {
    const [byEmail] = await tx.select().from(person).where(eq(person.email, email)).limit(1);
    if (byEmail) {
      if (user.sub && byEmail.externalSub && byEmail.externalSub !== user.sub)
        throw new ServiceApiError(409, "identity_conflict", "that email belongs to another sub");
      if (user.sub && !byEmail.externalSub) {
        const [row] = await tx
          .update(person)
          .set({ externalSub: user.sub })
          .where(eq(person.id, byEmail.id))
          .returning();
        return { row: row!, createdPerson: false };
      }
      return { row: byEmail, createdPerson: false };
    }
  }
  if (env.authMode !== "oidc")
    throw new ServiceApiError(404, "user_not_found", "no such person (AUTH_MODE is not oidc)");

  const address = email ?? placeholderEmail(user.sub!);
  const inserted = await tx
    .insert(person)
    .values({
      email: address,
      name: user.name ?? email ?? user.sub!,
      roles: ["student"],
      externalSub: user.sub ?? null,
      // A made-up address must never receive mail.
      emailOptOut: !email,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { row: inserted[0], createdPerson: true };
  // A concurrent request created the same placeholder first.
  const [row] = await tx.select().from(person).where(eq(person.email, address)).limit(1);
  if (!row) throw new ServiceApiError(409, "identity_conflict", "that sub is already in use");
  return { row, createdPerson: false };
}

async function view(tx: DbOrTx, row: typeof enrollment.$inferSelect, p: PersonRow) {
  const [c] = await tx
    .select({ slug: course.slug, externalRef: course.externalRef })
    .from(course)
    .where(eq(course.id, row.courseId))
    .limit(1);
  const [g] = row.cohortId
    ? await tx
        .select({ slug: cohort.slug, externalRef: cohort.externalRef })
        .from(cohort)
        .where(eq(cohort.id, row.cohortId))
        .limit(1)
    : [];
  return {
    externalId: row.externalId!,
    course: c!,
    cohort: g ?? null,
    user: { sub: p.externalSub, email: p.email, pending: p.lastSeenAt === null },
    status: row.status,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  } satisfies EnrollmentView;
}

const time = (d: Date | null | undefined) => d?.getTime() ?? null;

/**
 * Idempotent upsert of the `webhook` enrollment `externalId`. PUT replaces the representation:
 * an omitted `cohort` or `valid_until` means none; an omitted `valid_from` keeps the stored one
 * (now on creation). A revoked row becomes active again. A row is never moved to another person
 * (409), and a person holds at most one `webhook` row per course and cohort (409).
 */
export async function putServiceEnrollment(
  actor: ServiceActor,
  input: PutEnrollmentInput,
  now: Date = new Date(),
): Promise<PutEnrollmentResult> {
  assertService(actor);
  return db.transaction(async (tx) => {
    const refs = await loadRefs(tx, [{ course: input.course, cohort: input.cohort }]);
    const c = refs.course(input.course);
    if (!c) throw new ServiceApiError(404, "course_not_found", `unknown course "${input.course}"`);
    const g = input.cohort ? refs.cohort(input.cohort) : null;
    if (input.cohort && !g)
      throw new ServiceApiError(404, "cohort_not_found", `unknown cohort "${input.cohort}"`);
    if (g && g.courseId !== c.id)
      throw new ServiceApiError(
        422,
        "cohort_course_mismatch",
        "the cohort belongs to another course",
      );
    const cohortId = g?.id ?? null;

    const { row: p, createdPerson } = await resolvePerson(tx, input.user);

    const find = () =>
      tx
        .select()
        .from(enrollment)
        .where(and(eq(enrollment.source, "webhook"), eq(enrollment.externalId, input.externalId)))
        .limit(1)
        .then((r) => r[0] ?? null);
    let existing = await find();
    if (existing && existing.personId !== p.id)
      throw new ServiceApiError(409, "external_id_conflict", "external_id belongs to another user");

    const sameSlot = and(
      eq(enrollment.personId, p.id),
      eq(enrollment.courseId, c.id),
      eq(enrollment.source, "webhook"),
      cohortId ? eq(enrollment.cohortId, cohortId) : sql`${enrollment.cohortId} is null`,
    );
    const slotTaken = async (exceptId?: string) => {
      const [other] = await tx
        .select({ externalId: enrollment.externalId })
        .from(enrollment)
        .where(exceptId ? and(sameSlot, ne(enrollment.id, exceptId)) : sameSlot)
        .limit(1);
      return other ?? null;
    };

    const values = {
      courseId: c.id,
      cohortId,
      status: "active" as const,
      validFrom: input.validFrom ?? existing?.validFrom ?? now,
      validUntil: input.validUntil ?? null,
    };

    let created = false;
    let changed = false;
    let before: typeof enrollment.$inferSelect | null = existing;
    let row: typeof enrollment.$inferSelect;
    if (!existing) {
      const other = await slotTaken();
      if (other)
        throw new ServiceApiError(
          409,
          "duplicate_enrollment",
          `this user already has the webhook enrollment "${other.externalId}" for that course and cohort`,
        );
      const [inserted] = await tx
        .insert(enrollment)
        .values({ personId: p.id, source: "webhook", externalId: input.externalId, ...values })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        row = inserted;
        created = changed = true;
      } else {
        // A concurrent request inserted the same external_id between our read and write.
        existing = await find();
        if (!existing || existing.personId !== p.id)
          throw new ServiceApiError(409, "external_id_conflict", "external_id is in use");
        before = existing;
        row = existing;
      }
    } else {
      row = existing;
    }
    if (!created) {
      const same =
        row.status === values.status &&
        row.courseId === values.courseId &&
        row.cohortId === values.cohortId &&
        time(row.validFrom) === time(values.validFrom) &&
        time(row.validUntil) === time(values.validUntil);
      if (!same) {
        if (row.courseId !== values.courseId || row.cohortId !== values.cohortId) {
          const other = await slotTaken(row.id);
          if (other)
            throw new ServiceApiError(
              409,
              "duplicate_enrollment",
              `this user already has the webhook enrollment "${other.externalId}" for that course and cohort`,
            );
        }
        const [updated] = await tx
          .update(enrollment)
          .set(values)
          .where(eq(enrollment.id, row.id))
          .returning();
        row = updated!;
        changed = true;
      }
    }
    if (cohortId)
      await tx
        .insert(cohortMember)
        .values({ cohortId, personId: p.id, role: "student" })
        .onConflictDoNothing();

    if (changed || createdPerson) {
      await audit(tx, {
        actorId: null,
        actor: SERVICE_ACTOR_LABEL,
        action: "enrollment.service_put",
        entity: "enrollment",
        entityId: row.id,
        before: before && {
          status: before.status,
          validFrom: before.validFrom,
          validUntil: before.validUntil,
          courseId: before.courseId,
          cohortId: before.cohortId,
        },
        after: {
          externalId: input.externalId,
          personId: p.id,
          placeholderCreated: createdPerson,
          status: row.status,
          courseId: row.courseId,
          cohortId: row.cohortId,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
        },
      });
    }
    return { enrollment: await view(tx, row, p), created, changed };
  });
}

export interface RevokeResult {
  externalId: string;
  found: boolean;
  changed: boolean;
}

/** Marks the `webhook` enrollment `externalId` revoked (kept for the history). Idempotent. */
export async function revokeServiceEnrollment(
  actor: ServiceActor,
  externalId: string,
): Promise<RevokeResult> {
  assertService(actor);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(enrollment)
      .where(and(eq(enrollment.source, "webhook"), eq(enrollment.externalId, externalId)))
      .limit(1);
    if (!row) return { externalId, found: false, changed: false };
    if (row.status === "revoked") return { externalId, found: true, changed: false };
    await tx.update(enrollment).set({ status: "revoked" }).where(eq(enrollment.id, row.id));
    await audit(tx, {
      actorId: null,
      actor: SERVICE_ACTOR_LABEL,
      action: "enrollment.service_revoke",
      entity: "enrollment",
      entityId: row.id,
      before: { status: row.status },
      after: { externalId, status: "revoked", personId: row.personId },
    });
    return { externalId, found: true, changed: true };
  });
}
