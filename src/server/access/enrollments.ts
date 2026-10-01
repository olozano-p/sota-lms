/**
 * The enrollments/v1 contract (docs/entitlements-contract.md): pull on login and on cache miss,
 * push through the HMAC-signed webhook. Together with the OIDC callback this module is the only
 * writer of `person` rows and of `enrollment` rows with `source = 'webhook'`. It reconciles those
 * by `external_id` and never creates, changes or deletes a `manual` row (ADR-014).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import {
  cohort,
  cohortMember,
  course,
  enrollment,
  ENROLLMENT_STATUSES,
  person,
  session,
  webhookEvent,
} from "~/db/schema";
import { env } from "~/config/env";
import { isLocale } from "~/i18n/locale";

export const ENROLLMENTS_VERSION = "enrollments/v1";
export const ENROLLMENTS_TTL_MS = 15 * 60 * 1000;
export const WEBHOOK_MAX_SKEW_S = 5 * 60;

const instant = z.string().datetime({ offset: true });

export const enrollmentPayloadSchema = z.object({
  version: z.literal(ENROLLMENTS_VERSION),
  sub: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  locale: z.string().nullable().optional(),
  roles: z.array(z.string()).default([]),
  enrollments: z
    .array(
      z.object({
        /** The external system's id for this enrollment; the reconciliation key. */
        external_id: z.string().min(1),
        course: z.string().min(1),
        cohort: z.string().min(1).nullable().optional(),
        valid_from: instant.nullable().optional(),
        valid_until: instant.nullable().optional(),
        status: z.enum(ENROLLMENT_STATUSES).default("active"),
      }),
    )
    .default([]),
});
export type EnrollmentPayload = z.infer<typeof enrollmentPayloadSchema>;

/**
 * Reconciles a person's `webhook` rows with the payload: matched by `external_id` (or, for a new
 * id, by course and cohort), updated or inserted; rows the payload no longer lists are revoked,
 * not deleted, so the history stays. References to unknown courses or cohorts are skipped.
 * A cohort-scoped enrollment also places the person in that cohort as a student.
 */
async function reconcileEnrollments(
  tx: DbOrTx,
  personId: string,
  items: EnrollmentPayload["enrollments"],
  now: Date,
): Promise<void> {
  const courseSlugs = [...new Set(items.map((i) => i.course))];
  const cohortSlugs = [...new Set(items.flatMap((i) => (i.cohort ? [i.cohort] : [])))];
  const courses = courseSlugs.length
    ? await tx
        .select({ id: course.id, slug: course.slug })
        .from(course)
        .where(inArray(course.slug, courseSlugs))
    : [];
  const cohorts = cohortSlugs.length
    ? await tx
        .select({ id: cohort.id, slug: cohort.slug, courseId: cohort.courseId })
        .from(cohort)
        .where(inArray(cohort.slug, cohortSlugs))
    : [];
  const existing = await tx
    .select()
    .from(enrollment)
    .where(and(eq(enrollment.personId, personId), eq(enrollment.source, "webhook")));

  const seen = new Set<string>();
  const placements = new Set<string>();
  for (const item of items) {
    const c = courses.find((x) => x.slug === item.course);
    const g = item.cohort ? cohorts.find((x) => x.slug === item.cohort) : null;
    if (!c || (item.cohort && (!g || g.courseId !== c.id))) continue;
    const cohortId = g?.id ?? null;
    const values = {
      courseId: c.id,
      cohortId,
      externalId: item.external_id,
      validFrom: item.valid_from ? new Date(item.valid_from) : now,
      validUntil: item.valid_until ? new Date(item.valid_until) : null,
      status: item.status,
    };
    const row =
      existing.find((e) => e.externalId === item.external_id) ??
      existing.find((e) => e.courseId === c.id && e.cohortId === cohortId && !seen.has(e.id));
    if (row) {
      seen.add(row.id);
      await tx.update(enrollment).set(values).where(eq(enrollment.id, row.id));
    } else {
      const [created] = await tx
        .insert(enrollment)
        .values({ personId, source: "webhook", ...values })
        .returning({ id: enrollment.id });
      seen.add(created!.id);
    }
    if (cohortId && item.status === "active") placements.add(cohortId);
  }

  for (const e of existing) {
    if (!seen.has(e.id) && e.status !== "revoked") {
      await tx.update(enrollment).set({ status: "revoked" }).where(eq(enrollment.id, e.id));
    }
  }
  if (placements.size) {
    await tx
      .insert(cohortMember)
      .values([...placements].map((cohortId) => ({ cohortId, personId, role: "student" as const })))
      .onConflictDoNothing();
  }
}

/**
 * Upserts the person and reconciles their `webhook` enrollments in one transaction. A change of
 * roles invalidates the person's sessions so the next request re-logs them in (silently, through
 * the IdP) with the new privileges.
 */
export async function applyEnrollmentPayload(
  payload: EnrollmentPayload,
  tx: DbOrTx = db,
): Promise<string> {
  const now = new Date();
  const [p] = await tx
    .insert(person)
    .values({
      idpSub: payload.sub,
      email: payload.email,
      name: payload.name,
      locale: isLocale(payload.locale) ? payload.locale : null,
      roles: payload.roles,
      entitlementsSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: person.idpSub,
      set: {
        email: payload.email,
        name: payload.name,
        locale: isLocale(payload.locale) ? payload.locale : null,
        roles: payload.roles,
        entitlementsSyncedAt: now,
      },
    })
    .returning({ id: person.id, roles: person.roles });
  const personId = p!.id;

  await reconcileEnrollments(tx, personId, payload.enrollments, now);

  const sessions = await tx
    .select({ id: session.id, roles: session.roles })
    .from(session)
    .where(eq(session.personId, personId));
  const changed = sessions.filter(
    (s) => s.roles.slice().sort().join(",") !== payload.roles.slice().sort().join(","),
  );
  for (const s of changed) await tx.delete(session).where(eq(session.id, s.id));

  return personId;
}

/** Pull channel: `GET ${ENTITLEMENTS_PULL_URL}/{sub}` (the variable names predate ADR-014). Returns null when the source has no record. */
export async function pullEnrollments(sub: string): Promise<EnrollmentPayload | null> {
  const res = await fetch(`${env.entitlements.pullUrl}/${encodeURIComponent(sub)}`, {
    headers: { authorization: `Bearer ${env.entitlements.pullToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`enrollment source answered ${res.status}`);
  return enrollmentPayloadSchema.parse(await res.json());
}

/** Pull + apply. Called on login and by `ensureFreshEnrollments`. */
export async function syncEnrollments(sub: string): Promise<string | null> {
  const payload = await pullEnrollments(sub);
  if (!payload) return null;
  return db.transaction((tx) => applyEnrollmentPayload(payload, tx));
}

/** Refreshes when the cache is older than the TTL. Failures are swallowed: the cache self-heals. */
export async function ensureFreshEnrollments(personId: string): Promise<void> {
  const rows = await db
    .select({ sub: person.idpSub, syncedAt: person.entitlementsSyncedAt })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.syncedAt && Date.now() - row.syncedAt.getTime() < ENROLLMENTS_TTL_MS) return;
  try {
    await syncEnrollments(row.sub);
  } catch (e) {
    console.warn(`enrollment sync failed for ${row.sub}: ${(e as Error).message}`);
  }
}

// ---------- Push channel ----------

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export interface WebhookHeaders {
  timestamp: string | null;
  signature: string | null;
  eventId: string | null;
}

export type WebhookOutcome =
  | { status: 200; body: { ok: true; duplicate?: true } }
  | { status: 400 | 401 | 422; body: { ok: false; error: string } };

/**
 * Verify → store → process → 200. The event row is written before processing so a failure is
 * visible in the admin log; duplicates (same `X-Event-Id`) return 200 without reprocessing.
 */
export async function handleEnrollmentWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  opts: { secret: string; now?: Date; tx?: DbOrTx } = { secret: env.entitlements.webhookSecret },
): Promise<WebhookOutcome> {
  const tx = opts.tx ?? db;
  const now = opts.now ?? new Date();
  if (!headers.timestamp || !headers.signature || !headers.eventId) {
    return {
      status: 400,
      body: { ok: false, error: "missing X-Timestamp, X-Signature or X-Event-Id" },
    };
  }
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > WEBHOOK_MAX_SKEW_S) {
    return { status: 401, body: { ok: false, error: "timestamp outside the allowed window" } };
  }
  const expected = Buffer.from(signWebhook(opts.secret, headers.timestamp, rawBody));
  const given = Buffer.from(headers.signature);
  const valid = expected.length === given.length && timingSafeEqual(expected, given);
  if (!valid) return { status: 401, body: { ok: false, error: "invalid signature" } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "body is not JSON" } };
  }

  const inserted = await tx
    .insert(webhookEvent)
    .values({
      source: "entitlements",
      externalId: headers.eventId,
      eventType: "enrollments.updated",
      payload: json as Record<string, unknown>,
      signatureValid: true,
    })
    .onConflictDoNothing({ target: webhookEvent.externalId })
    .returning({ id: webhookEvent.id });
  if (!inserted[0]) return { status: 200, body: { ok: true, duplicate: true } };
  const eventId = inserted[0].id;

  const parsed = enrollmentPayloadSchema.safeParse(json);
  if (!parsed.success) {
    await tx
      .update(webhookEvent)
      .set({ error: parsed.error.message, processedAt: now })
      .where(eq(webhookEvent.id, eventId));
    return { status: 422, body: { ok: false, error: "payload does not match enrollments/v1" } };
  }
  try {
    await applyEnrollmentPayload(parsed.data, tx);
    await tx.update(webhookEvent).set({ processedAt: now }).where(eq(webhookEvent.id, eventId));
    return { status: 200, body: { ok: true } };
  } catch (e) {
    await tx
      .update(webhookEvent)
      .set({ error: (e as Error).message, processedAt: now })
      .where(eq(webhookEvent.id, eventId));
    throw e;
  }
}
