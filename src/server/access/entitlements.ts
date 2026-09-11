/**
 * The entitlements/v1 contract (docs/entitlements-contract.md): pull on login and on cache miss,
 * push through the HMAC-signed webhook. This module is the only writer of `person` rows and of
 * `entitlement` rows with `source = 'external'`, together with the OIDC callback.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import { entitlement, person, session, webhookEvent } from "~/db/schema";
import { env } from "~/config/env";
import { isLocale } from "~/i18n/locale";

export const ENTITLEMENTS_VERSION = "entitlements/v1";
export const ENTITLEMENTS_TTL_MS = 15 * 60 * 1000;
export const WEBHOOK_MAX_SKEW_S = 5 * 60;

export const entitlementPayloadSchema = z.object({
  version: z.literal(ENTITLEMENTS_VERSION),
  sub: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  locale: z.string().nullable().optional(),
  roles: z.array(z.string()).default([]),
  entitlements: z
    .array(
      z.object({
        scope: z.enum(["course", "all_courses", "cohort"]),
        ref: z.string().nullable(),
        rule: z.string().min(1),
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      }),
    )
    .default([]),
});
export type EntitlementPayload = z.infer<typeof entitlementPayloadSchema>;

/**
 * Upserts the person and replaces their external entitlements in one transaction. Admin grants
 * (`source = 'admin'`) are left alone. A change of roles invalidates the person's sessions so the
 * next request re-logs them in (silently, through the IdP) with the new privileges.
 */
export async function applyEntitlementPayload(
  payload: EntitlementPayload,
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

  await tx
    .delete(entitlement)
    .where(and(eq(entitlement.personId, personId), eq(entitlement.source, "external")));
  if (payload.entitlements.length) {
    await tx.insert(entitlement).values(
      payload.entitlements.map((e) => ({
        personId,
        scope: e.scope,
        ref: e.ref,
        rule: e.rule,
        until: e.until,
        source: "external" as const,
        syncedAt: now,
      })),
    );
  }

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

/** Pull channel: `GET ${ENTITLEMENTS_PULL_URL}/{sub}`. Returns null when the source has no record. */
export async function pullEntitlements(sub: string): Promise<EntitlementPayload | null> {
  const res = await fetch(`${env.entitlements.pullUrl}/${encodeURIComponent(sub)}`, {
    headers: { authorization: `Bearer ${env.entitlements.pullToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`entitlement source answered ${res.status}`);
  return entitlementPayloadSchema.parse(await res.json());
}

/** Pull + apply. Called on login and by `ensureFreshEntitlements`. */
export async function syncEntitlements(sub: string): Promise<string | null> {
  const payload = await pullEntitlements(sub);
  if (!payload) return null;
  return db.transaction((tx) => applyEntitlementPayload(payload, tx));
}

/** Refreshes when the cache is older than the TTL. Failures are swallowed: the cache self-heals. */
export async function ensureFreshEntitlements(personId: string): Promise<void> {
  const rows = await db
    .select({ sub: person.idpSub, syncedAt: person.entitlementsSyncedAt })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.syncedAt && Date.now() - row.syncedAt.getTime() < ENTITLEMENTS_TTL_MS) return;
  try {
    await syncEntitlements(row.sub);
  } catch (e) {
    console.warn(`entitlement sync failed for ${row.sub}: ${(e as Error).message}`);
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
export async function handleEntitlementWebhook(
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
      eventType: "entitlements.updated",
      payload: json as Record<string, unknown>,
      signatureValid: true,
    })
    .onConflictDoNothing({ target: webhookEvent.externalId })
    .returning({ id: webhookEvent.id });
  if (!inserted[0]) return { status: 200, body: { ok: true, duplicate: true } };
  const eventId = inserted[0].id;

  const parsed = entitlementPayloadSchema.safeParse(json);
  if (!parsed.success) {
    await tx
      .update(webhookEvent)
      .set({ error: parsed.error.message, processedAt: now })
      .where(eq(webhookEvent.id, eventId));
    return { status: 422, body: { ok: false, error: "payload does not match entitlements/v1" } };
  }
  try {
    await applyEntitlementPayload(parsed.data, tx);
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
