import type { DbOrTx } from "../db/index.ts";
import { auditLog, type enrollment } from "../db/schema.ts";

/** Every mutation appends one of these inside its own transaction (CLAUDE.md invariants). */
export async function audit(
  tx: DbOrTx,
  entry: {
    actorId: string | null;
    /** Non-person actor (the service API, the sync): recorded in the diff as `actor`. */
    actor?: string;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    actorPersonId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    diff:
      entry.before === undefined && entry.after === undefined && !entry.actor
        ? null
        : {
            ...(entry.actor ? { actor: entry.actor } : {}),
            before: entry.before ?? null,
            after: entry.after ?? null,
          },
  });
}

// ---------- Enrollment changes ----------

/** Most per-row entries one audit row carries; the rest is counted (`total`, `truncated`). */
export const AUDIT_DETAIL_CAP = 100;

type EnrollmentRow = typeof enrollment.$inferSelect;

/** What an audit row keeps of an enrollment: who, what, how, and when it applies. */
export function enrollmentSnapshot(row: EnrollmentRow) {
  return {
    personId: row.personId,
    courseId: row.courseId,
    cohortId: row.cohortId,
    source: row.source,
    externalId: row.externalId,
    status: row.status,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  };
}
export type EnrollmentSnapshot = ReturnType<typeof enrollmentSnapshot>;

export type EnrollmentOp =
  | "created"
  | "updated"
  | "revoked"
  | "expired"
  | "deleted"
  | "moved"
  | "unchanged";

/** One enrollment row's change, as written to `audit_log.diff`. */
export interface EnrollmentChange {
  enrollmentId: string;
  op: EnrollmentOp;
  before: EnrollmentSnapshot | null;
  after: EnrollmentSnapshot | null;
  /** Anything the path knows about the row that the snapshot does not (an address, an outcome). */
  note?: Record<string, unknown>;
}

/** Builds a change from the rows before and after; null before is a creation, null after a deletion. */
export function enrollmentChange(
  before: EnrollmentRow | null,
  after: EnrollmentRow | null,
  op?: EnrollmentOp,
  note?: Record<string, unknown>,
): EnrollmentChange {
  const row = (after ?? before)!;
  return {
    enrollmentId: row.id,
    op: op ?? (!before ? "created" : !after ? "deleted" : "updated"),
    before: before && enrollmentSnapshot(before),
    after: after && enrollmentSnapshot(after),
    ...(note ? { note } : {}),
  };
}

/** True when two rows differ in anything an audit row records. */
export function enrollmentDiffers(a: EnrollmentRow, b: EnrollmentRow): boolean {
  return JSON.stringify(enrollmentSnapshot(a)) !== JSON.stringify(enrollmentSnapshot(b));
}

/** The first `cap` entries plus how many there were, so a bulk write cannot bloat the log. */
export function capDetail<T>(rows: T[], cap = AUDIT_DETAIL_CAP) {
  return { rows: rows.slice(0, cap), total: rows.length, truncated: rows.length > cap };
}

/** The `after` value of an audit row that lists changed enrollments. */
export function enrollmentDetail(changes: EnrollmentChange[], extra: Record<string, unknown> = {}) {
  const { rows, total, truncated } = capDetail(changes);
  return { ...extra, total, truncated, changes: rows };
}
