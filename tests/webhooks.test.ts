/** Push channel on the in-memory PGlite: signature, skew, idempotency, upsert semantics. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { entitlement, person, session, webhookEvent } from "../src/db/schema.ts";
import { handleEntitlementWebhook, signWebhook } from "../src/server/access/entitlements.ts";

const SECRET = "test-webhook-secret";
const NOW = new Date("2026-09-11T10:00:00Z");

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: "entitlements/v1",
    sub: "u-1",
    email: "one@example.invalid",
    name: "One",
    locale: "ca",
    roles: ["student"],
    entitlements: [{ scope: "course", ref: "c1", rule: "immediate", until: null }],
    ...over,
  });
}

function headers(
  body: string,
  eventId: string = crypto.randomUUID(),
  ts = String(Math.floor(NOW.getTime() / 1000)),
) {
  return {
    timestamp: ts as string | null,
    signature: signWebhook(SECRET, ts, body) as string | null,
    eventId: eventId as string | null,
  };
}

const handle = (body: string, h: ReturnType<typeof headers>, now = NOW) =>
  handleEntitlementWebhook(body, h, { secret: SECRET, now });

beforeAll(async () => {
  await runMigrations(db);
});

describe("verification", () => {
  it("rejects missing headers", async () => {
    const r = await handle(payload(), { timestamp: null, signature: null, eventId: null });
    expect(r.status).toBe(400);
  });
  it("rejects a bad signature", async () => {
    const body = payload();
    const h = headers(body);
    const r = await handle(body, { ...h, signature: "0".repeat(64) });
    expect(r.status).toBe(401);
    expect(
      await db.select().from(webhookEvent).where(eq(webhookEvent.externalId, h.eventId!)),
    ).toHaveLength(0);
  });
  it("rejects timestamps outside the 5-minute window", async () => {
    const body = payload();
    const old = String(Math.floor(NOW.getTime() / 1000) - 6 * 60);
    expect((await handle(body, headers(body, undefined, old))).status).toBe(401);
    const fresh = String(Math.floor(NOW.getTime() / 1000) - 4 * 60);
    expect((await handle(body, headers(body, undefined, fresh))).status).toBe(200);
  });
  it("stores and reports a payload that fails the contract", async () => {
    const body = JSON.stringify({ version: "entitlements/v1", sub: "x" });
    const h = headers(body);
    const r = await handle(body, h);
    expect(r.status).toBe(422);
    const [ev] = await db
      .select()
      .from(webhookEvent)
      .where(eq(webhookEvent.externalId, h.eventId!));
    expect(ev?.error).toBeTruthy();
    expect(ev?.processedAt).toBeTruthy();
  });
});

describe("processing", () => {
  it("mirrors the person and replaces external entitlements, keeping admin grants", async () => {
    const first = payload();
    expect((await handle(first, headers(first))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.idpSub, "u-1"));
    expect(p?.email).toBe("one@example.invalid");
    expect(p?.roles).toEqual(["student"]);
    expect(p?.entitlementsSyncedAt).toBeTruthy();

    await db.insert(entitlement).values({
      personId: p!.id,
      scope: "course",
      ref: "manual",
      rule: "immediate",
      until: null,
      source: "admin",
    });

    const second = payload({
      entitlements: [{ scope: "all_courses", ref: null, rule: "delayed", until: "2027-01-31" }],
    });
    expect((await handle(second, headers(second))).status).toBe(200);
    const rows = await db.select().from(entitlement).where(eq(entitlement.personId, p!.id));
    expect(
      rows.map((r) => `${r.source}:${r.scope}:${r.ref ?? ""}:${r.rule}:${r.until ?? ""}`).sort(),
    ).toEqual(["admin:course:manual:immediate:", "external:all_courses::delayed:2027-01-31"]);
  });
  it("is idempotent on X-Event-Id", async () => {
    const body = payload({ sub: "u-2", email: "two@example.invalid", name: "Two" });
    const h = headers(body);
    expect(await handle(body, h)).toEqual({ status: 200, body: { ok: true } });
    expect(await handle(body, h)).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(
      await db.select().from(webhookEvent).where(eq(webhookEvent.externalId, h.eventId!)),
    ).toHaveLength(1);
  });
  it("invalidates sessions when roles change", async () => {
    const body = payload({
      sub: "u-3",
      email: "three@example.invalid",
      name: "Three",
      roles: ["student"],
    });
    await handle(body, headers(body));
    const [p] = await db.select().from(person).where(eq(person.idpSub, "u-3"));
    await db.insert(session).values({
      personId: p!.id,
      absoluteExpiresAt: new Date(NOW.getTime() + 3600_000),
      roles: ["student"],
    });

    const same = payload({
      sub: "u-3",
      email: "three@example.invalid",
      name: "Three",
      roles: ["student"],
    });
    await handle(same, headers(same));
    expect(await db.select().from(session).where(eq(session.personId, p!.id))).toHaveLength(1);

    const promoted = payload({
      sub: "u-3",
      email: "three@example.invalid",
      name: "Three",
      roles: ["student", "teacher"],
    });
    await handle(promoted, headers(promoted));
    expect(await db.select().from(session).where(eq(session.personId, p!.id))).toHaveLength(0);
  });
});
