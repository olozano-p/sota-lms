/** Admin overrides: `source = 'admin'` rows that the external sync never touches. */
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { entitlement, person } from "~/db/schema";
import { lmsConfig } from "~/config";
import { audit } from "~/server/audit";
import { requireRole } from "~/server/auth/authz";
import { syncEntitlements } from "~/server/access/entitlements";

const grantSchema = z.object({
  personId: z.string().uuid(),
  scope: z.enum(["course", "all_courses", "cohort"]),
  ref: z.string().trim().min(1).nullable(),
  rule: z.string().min(1),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export const grantEntitlement = createServerFn({ method: "POST" })
  .validator(grantSchema)
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    if (!(data.rule in lmsConfig.accessRules)) throw new Error("unknown rule");
    const ref = data.scope === "all_courses" ? null : data.ref;
    if (data.scope !== "all_courses" && !ref) throw new Error("ref required");
    return db.transaction(async (tx) => {
      await tx
        .delete(entitlement)
        .where(
          and(
            eq(entitlement.personId, data.personId),
            eq(entitlement.scope, data.scope),
            ref === null
              ? eq(entitlement.source, "admin")
              : and(eq(entitlement.ref, ref), eq(entitlement.source, "admin"))!,
          ),
        );
      const [row] = await tx
        .insert(entitlement)
        .values({
          personId: data.personId,
          scope: data.scope,
          ref,
          rule: data.rule,
          until: data.until,
          source: "admin",
        })
        .returning();
      await audit(tx, {
        actorId: admin.id,
        action: "entitlement.grant",
        entity: "entitlement",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const revokeEntitlement = createServerFn({ method: "POST" })
  .validator(z.object({ entitlementId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(entitlement)
        .where(and(eq(entitlement.id, data.entitlementId), eq(entitlement.source, "admin")))
        .limit(1);
      if (!row) throw new Error("only admin grants can be revoked here");
      await tx.delete(entitlement).where(eq(entitlement.id, row.id));
      await audit(tx, {
        actorId: admin.id,
        action: "entitlement.revoke",
        entity: "entitlement",
        entityId: row.id,
        before: row,
      });
      return { ok: true };
    });
  });

/** Pull from the entitlement source now instead of waiting for the TTL. */
export const resyncPerson = createServerFn({ method: "POST" })
  .validator(z.object({ personId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    const [p] = await db
      .select({ sub: person.idpSub })
      .from(person)
      .where(eq(person.id, data.personId))
      .limit(1);
    if (!p) throw new Error("person not found");
    const result = await syncEntitlements(p.sub);
    await audit(db, {
      actorId: admin.id,
      action: "entitlement.resync",
      entity: "person",
      entityId: data.personId,
      after: { found: result !== null },
    });
    return { found: result !== null };
  });
