/**
 * Enrollment sync from the ID token (brief §6.1, ADR-014): when `ENTITLEMENT_CLAIM` names a claim
 * holding `[{course, cohort?, until?}]`, each sign-in reconciles the person's `source = 'claims'`
 * rows with it. `manual` and `webhook` rows are never read or written here. Plain-Node safe: the
 * sign-in hook calls it.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../../db/index.ts";
import { cohortMember, enrollment } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { loadRefs } from "./refs.ts";

const claimSchema = z.array(
  z.object({
    /** Slug or `external_ref` of the course. */
    course: z.string().min(1),
    /** Slug or `external_ref` of a cohort of that course. */
    cohort: z.string().min(1).nullable().optional(),
    /** Exclusive end of access; omitted or null is open-ended. */
    until: z.string().datetime({ offset: true }).nullable().optional(),
  }),
);
export type EnrollmentClaim = z.infer<typeof claimSchema>;

export interface ClaimsSyncResult {
  created: number;
  updated: number;
  expired: number;
  /** References that matched no course or cohort; logged and skipped. */
  ignored: string[];
  /** False when the claim was malformed and nothing was changed. */
  valid: boolean;
}

/**
 * Reconciles `claims` rows for one person against the claim value. Unknown references are logged
 * and ignored; rows the claim no longer lists become `expired` (never deleted, so history stays);
 * a malformed claim changes nothing. A cohort-scoped enrollment also places the person in that
 * cohort as a student, as the webhook does.
 */
export async function syncClaimEnrollments(
  personId: string,
  claimValue: unknown,
  now = new Date(),
  tx: DbOrTx = db,
): Promise<ClaimsSyncResult> {
  const result: ClaimsSyncResult = { created: 0, updated: 0, expired: 0, ignored: [], valid: true };
  const parsed = claimSchema.safeParse(claimValue);
  if (!parsed.success) {
    console.warn(`claims sync: malformed enrollment claim for ${personId}, ignored`);
    return { ...result, valid: false };
  }
  const items = parsed.data;
  const refs = await loadRefs(tx, items);
  const existing = await tx
    .select()
    .from(enrollment)
    .where(and(eq(enrollment.personId, personId), eq(enrollment.source, "claims")));

  const seen = new Set<string>();
  const placements = new Set<string>();
  for (const item of items) {
    const c = refs.course(item.course);
    const g = item.cohort ? refs.cohort(item.cohort) : null;
    if (!c || (item.cohort && (!g || g.courseId !== c.id))) {
      const label = item.cohort ? `${item.course}/${item.cohort}` : item.course;
      console.warn(`claims sync: unknown course or cohort reference "${label}", ignored`);
      result.ignored.push(label);
      continue;
    }
    const cohortId = g?.id ?? null;
    const validUntil = item.until ? new Date(item.until) : null;
    const row = existing.find((e) => e.courseId === c.id && e.cohortId === cohortId);
    if (row) {
      seen.add(row.id);
      const changed =
        row.status !== "active" ||
        (row.validUntil?.getTime() ?? null) !== (validUntil?.getTime() ?? null);
      if (changed) {
        await tx
          .update(enrollment)
          .set({ status: "active", validUntil })
          .where(eq(enrollment.id, row.id));
        result.updated++;
      }
    } else {
      const [created] = await tx
        .insert(enrollment)
        .values({
          personId,
          courseId: c.id,
          cohortId,
          source: "claims",
          validFrom: now,
          validUntil,
          status: "active",
        })
        .returning({ id: enrollment.id });
      seen.add(created!.id);
      result.created++;
    }
    if (cohortId) placements.add(cohortId);
  }

  for (const row of existing) {
    if (!seen.has(row.id) && row.status === "active") {
      await tx.update(enrollment).set({ status: "expired" }).where(eq(enrollment.id, row.id));
      result.expired++;
    }
  }
  if (placements.size) {
    await tx
      .insert(cohortMember)
      .values([...placements].map((cohortId) => ({ cohortId, personId, role: "student" as const })))
      .onConflictDoNothing();
  }
  if (result.created || result.updated || result.expired) {
    await audit(tx, {
      actorId: null,
      action: "enrollment.claims_sync",
      entity: "person",
      entityId: personId,
      after: { created: result.created, updated: result.updated, expired: result.expired },
    });
  }
  return result;
}
