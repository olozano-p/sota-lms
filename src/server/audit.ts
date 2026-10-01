import type { DbOrTx } from "../db/index.ts";
import { auditLog } from "../db/schema.ts";

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
