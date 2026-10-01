import { createServerFn } from "@tanstack/react-start";
import { desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import {
  auditLog,
  cohort,
  course,
  enrollment,
  invitation,
  person,
  webhookEvent,
} from "~/db/schema";
import { requireRole } from "~/server/auth/authz";

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
        enrollmentCount:
          sql<number>`(select count(*) from ${enrollment} where ${enrollment.personId} = ${sql.raw('"person"."id"')} and ${enrollment.status} = 'active')`.mapWith(
            Number,
          ),
      })
      .from(person)
      .where(
        q
          ? or(
              ilike(person.name, `%${q}%`),
              ilike(person.email, `%${q}%`),
              ilike(person.externalSub, `%${q}%`),
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
    const enrollments = await db
      .select({
        id: enrollment.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        cohortSlug: cohort.slug,
        source: enrollment.source,
        externalId: enrollment.externalId,
        status: enrollment.status,
        validFrom: enrollment.validFrom,
        validUntil: enrollment.validUntil,
      })
      .from(enrollment)
      .innerJoin(course, eq(course.id, enrollment.courseId))
      .leftJoin(cohort, eq(cohort.id, enrollment.cohortId))
      .where(eq(enrollment.personId, p.id))
      .orderBy(enrollment.source, course.slug, cohort.slug);
    return { person: p, enrollments };
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

/** Pending invitations (local mode): who was invited, with which roles, until when. */
export const listInvitations = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  return db
    .select({
      id: invitation.id,
      personId: person.id,
      email: person.email,
      name: person.name,
      roles: person.roles,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .innerJoin(person, eq(person.id, invitation.personId))
    .where(isNull(invitation.acceptedAt))
    .orderBy(desc(invitation.createdAt))
    .limit(200);
});
