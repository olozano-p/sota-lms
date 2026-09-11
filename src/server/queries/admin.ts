import { createServerFn } from "@tanstack/react-start";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { auditLog, entitlement, person, webhookEvent } from "~/db/schema";
import { requireRole } from "~/server/auth/authz";
import { lmsConfig } from "~/config";

export const listPeople = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireRole("admin");
    const q = data.q?.trim();
    const rows = await db
      .select({
        id: person.id,
        name: person.name,
        email: person.email,
        roles: person.roles,
        lastSeenAt: person.lastSeenAt,
        entitlementsSyncedAt: person.entitlementsSyncedAt,
        entitlementCount:
          sql<number>`(select count(*) from ${entitlement} where ${entitlement.personId} = ${person.id})`.mapWith(
            Number,
          ),
      })
      .from(person)
      .where(
        q
          ? or(
              ilike(person.name, `%${q}%`),
              ilike(person.email, `%${q}%`),
              ilike(person.idpSub, `%${q}%`),
            )
          : undefined,
      )
      .orderBy(desc(person.lastSeenAt), person.name)
      .limit(200);
    return rows;
  });

export const getPerson = createServerFn({ method: "GET" })
  .validator(z.object({ personId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireRole("admin");
    const [p] = await db.select().from(person).where(eq(person.id, data.personId)).limit(1);
    if (!p) return null;
    const ents = await db
      .select()
      .from(entitlement)
      .where(eq(entitlement.personId, p.id))
      .orderBy(entitlement.source, entitlement.scope, entitlement.ref);
    return { person: p, entitlements: ents, ruleNames: Object.keys(lmsConfig.accessRules) };
  });

export const listWebhookEvents = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const rows = await db
    .select()
    .from(webhookEvent)
    .orderBy(desc(webhookEvent.receivedAt))
    .limit(200);
  return rows.map((r) => ({ ...r, payload: JSON.stringify(r.payload) }));
});

export const listAuditLog = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      diff: auditLog.diff,
      actorName: person.name,
    })
    .from(auditLog)
    .leftJoin(person, eq(person.id, auditLog.actorPersonId))
    .orderBy(desc(auditLog.at))
    .limit(300);
  return rows.map((r) => ({ ...r, diff: r.diff === null ? null : JSON.stringify(r.diff) }));
});
