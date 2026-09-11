import type { DbOrTx } from "~/db";
import { auditLog } from "~/db/schema";

/** Every mutation appends one of these inside its own transaction (CLAUDE.md invariants). */
export async function audit(
  tx: DbOrTx,
  entry: {
    actorId: string | null;
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
      entry.before === undefined && entry.after === undefined
        ? null
        : { before: entry.before ?? null, after: entry.after ?? null },
  });
}
