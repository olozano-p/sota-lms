/**
 * The enrollments/v1 contract (docs/entitlements-contract.md): pull on login and on cache miss,
 * push through the HMAC-signed webhook. This module is the only writer of `enrollment` rows with
 * `source = 'webhook'` (login claims live in `claims.ts`) and, with the identity paths in
 * CLAUDE.md, of `person` rows. It reconciles by `external_id` and never creates, changes or deletes
 * a `manual` or `claims` row (ADR-014). Plain-Node safe: the sign-in hook and scripts call it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../../db/index.ts";
import {
  cohortMember,
  enrollment,
  ENROLLMENT_STATUSES,
  person,
  webhookEvent,
} from "../../db/schema.ts";
import { env } from "../../config/env.ts";
import {
  audit,
  enrollmentChange,
  enrollmentDetail,
  enrollmentDiffers,
  type EnrollmentChange,
} from "../audit.ts";
import { isLocale } from "../../i18n/locale.ts";
import { mapRoles } from "../auth/roles.ts";
import { loadRefs } from "./refs.ts";
import { errorFields, logger } from "../../lib/log.ts";

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
): Promise<EnrollmentChange[]> {
  const changes: EnrollmentChange[] = [];
  const refs = await loadRefs(tx, items);
  const existing = await tx
    .select()
    .from(enrollment)
    .where(and(eq(enrollment.personId, personId), eq(enrollment.source, "webhook")));

  const seen = new Set<string>();
  const placements = new Set<string>();
  for (const item of items) {
    const c = refs.course(item.course);
    const g = item.cohort ? refs.cohort(item.cohort) : null;
    if (!c || (item.cohort && (!g || g.courseId !== c.id))) {
      logger.warn("enrollment sync: unknown course or cohort reference", {
        course: item.course,
        cohort: item.cohort ?? null,
      });
      continue;
    }
    const cohortId = g?.id ?? null;
    const row =
      existing.find((e) => e.externalId === item.external_id) ??
      existing.find((e) => e.courseId === c.id && e.cohortId === cohortId && !seen.has(e.id));
    const values = {
      courseId: c.id,
      cohortId,
      externalId: item.external_id,
      // Without `valid_from` an existing row keeps its start, so a repeated sync changes nothing.
      validFrom: item.valid_from ? new Date(item.valid_from) : (row?.validFrom ?? now),
      validUntil: item.valid_until ? new Date(item.valid_until) : null,
      status: item.status,
    };
    if (row) {
      seen.add(row.id);
      const [updated] = await tx
        .update(enrollment)
        .set(values)
        .where(eq(enrollment.id, row.id))
        .returning();
      if (enrollmentDiffers(row, updated!)) changes.push(enrollmentChange(row, updated!));
    } else {
      const [created] = await tx
        .insert(enrollment)
        .values({ personId, source: "webhook", ...values })
        .returning();
      seen.add(created!.id);
      changes.push(enrollmentChange(null, created!));
    }
    if (cohortId && item.status === "active") placements.add(cohortId);
  }

  for (const e of existing) {
    if (!seen.has(e.id) && e.status !== "revoked") {
      const [revoked] = await tx
        .update(enrollment)
        .set({ status: "revoked" })
        .where(eq(enrollment.id, e.id))
        .returning();
      changes.push(enrollmentChange(e, revoked!, "revoked"));
    }
  }
  if (placements.size) {
    await tx
      .insert(cohortMember)
      .values([...placements].map((cohortId) => ({ cohortId, personId, role: "student" as const })))
      .onConflictDoNothing();
  }
  return changes;
}

/** Where an enrollment sync came from; recorded as the audit row's actor (`sync:<channel>`). */
export type SyncChannel = "webhook" | "pull";

/**
 * Finds the person for a sub (or, failing that, the one with the same email, which adopts the sub)
 * or creates it, then reconciles their `webhook` enrollments in one transaction. Roles from the
 * payload apply to a person matched or created by sub; a person adopted by email keeps their roles,
 * so a payload cannot demote a locally managed admin. Roles are read live per request, so a change
 * takes effect at once.
 */
export async function applyEnrollmentPayload(
  payload: EnrollmentPayload,
  conn: DbOrTx = db,
  channel: SyncChannel = "webhook",
): Promise<string> {
  return conn.transaction((tx) => applyPayload(tx, payload, channel));
}

/** Writes the person and the reconciled rows, and one audit row when any enrollment changed. */
async function applyPayload(
  tx: DbOrTx,
  payload: EnrollmentPayload,
  channel: SyncChannel,
): Promise<string> {
  const now = new Date();
  const email = payload.email.toLowerCase();
  const locale = isLocale(payload.locale) ? payload.locale : null;
  const roles = mapRoles(payload.roles);
  const [bySub] = await tx
    .select({ id: person.id })
    .from(person)
    .where(eq(person.externalSub, payload.sub))
    .limit(1);
  let personId: string;
  if (bySub) {
    personId = bySub.id;
    await tx
      .update(person)
      .set({ email, name: payload.name, locale, roles, entitlementsSyncedAt: now })
      .where(eq(person.id, personId));
  } else {
    const [byEmail] = await tx
      .select({ id: person.id })
      .from(person)
      .where(eq(person.email, email))
      .limit(1);
    if (byEmail) {
      personId = byEmail.id;
      await tx
        .update(person)
        .set({ externalSub: payload.sub, entitlementsSyncedAt: now })
        .where(eq(person.id, personId));
    } else {
      const [created] = await tx
        .insert(person)
        .values({
          email,
          name: payload.name,
          locale,
          roles,
          externalSub: payload.sub,
          entitlementsSyncedAt: now,
        })
        .returning({ id: person.id });
      personId = created!.id;
    }
  }

  const changes = await reconcileEnrollments(tx, personId, payload.enrollments, now);
  // A repeat of the same state (every pull and webhook retry) changes nothing and logs nothing.
  if (changes.length)
    await audit(tx, {
      actorId: null,
      actor: `sync:${channel}`,
      action: "enrollment.sync",
      entity: "person",
      entityId: personId,
      after: enrollmentDetail(changes, { channel }),
    });
  return personId;
}

/** Pull channel: `GET ${ENTITLEMENTS_PULL_URL}/{sub}` (the variable names predate ADR-014). Returns null when the source has no record. */
export async function pullEnrollments(sub: string): Promise<EnrollmentPayload | null> {
  const { pullUrl, pullToken } = env.entitlements;
  if (!pullUrl || !pullToken) return null;
  const res = await fetch(`${pullUrl}/${encodeURIComponent(sub)}`, {
    headers: { authorization: `Bearer ${pullToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`enrollment source answered ${res.status}`);
  return enrollmentPayloadSchema.parse(await res.json());
}

/** Pull + apply. Called on login and by `ensureFreshEnrollments`; a no-op when no pull URL is configured. */
export async function syncEnrollments(sub: string): Promise<string | null> {
  const payload = await pullEnrollments(sub);
  if (!payload) return null;
  return applyEnrollmentPayload(payload, db, "pull");
}

/** Refreshes when the cache is older than the TTL. Failures are swallowed: the cache self-heals. */
export async function ensureFreshEnrollments(personId: string): Promise<void> {
  const rows = await db
    .select({ sub: person.externalSub, syncedAt: person.entitlementsSyncedAt })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  const row = rows[0];
  if (!row?.sub || !env.entitlements.pullUrl) return;
  if (row.syncedAt && Date.now() - row.syncedAt.getTime() < ENROLLMENTS_TTL_MS) return;
  try {
    await syncEnrollments(row.sub);
  } catch (e) {
    logger.warn("enrollment sync failed", errorFields(e));
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
  opts: { secret: string | null; now?: Date; tx?: DbOrTx } = {
    secret: env.entitlements.webhookSecret,
  },
): Promise<WebhookOutcome> {
  if (!opts.secret) return { status: 401, body: { ok: false, error: "webhook is not configured" } };
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
