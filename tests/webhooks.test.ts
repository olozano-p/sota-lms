/** Push channel on the in-memory PGlite: signature, skew, idempotency, upsert semantics. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  cohort,
  cohortMember,
  course,
  enrollment,
  person,
  webhookEvent,
} from "../src/db/schema.ts";
import { handleEnrollmentWebhook, signWebhook } from "../src/server/access/enrollments.ts";

const SECRET = "test-webhook-secret";
const NOW = new Date("2026-09-11T10:00:00Z");

/** External ids are unique per source, so the default one carries the subject. */
function payload(over: Record<string, unknown> = {}) {
  const sub = (over.sub as string | undefined) ?? "u-1";
  return JSON.stringify({
    version: "enrollments/v1",
    sub: "u-1",
    email: "one@example.invalid",
    name: "One",
    locale: "ca",
    roles: ["student"],
    enrollments: [{ external_id: `ext-${sub}`, course: "c1" }],
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
  handleEnrollmentWebhook(body, h, { secret: SECRET, now });

let c1: string;
let c2: string;

beforeAll(async () => {
  await runMigrations(db);
  const courses = await db
    .insert(course)
    .values([
      { slug: "c1", title: "C1", language: "en" },
      { slug: "c2", title: "C2", language: "en" },
    ])
    .returning({ id: course.id, slug: course.slug });
  c1 = courses.find((c) => c.slug === "c1")!.id;
  c2 = courses.find((c) => c.slug === "c2")!.id;
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
    const body = JSON.stringify({ version: "enrollments/v1", sub: "x" });
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
  it("mirrors the person and reconciles webhook enrollments, never touching manual ones", async () => {
    const first = payload();
    expect((await handle(first, headers(first))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-1"));
    expect(p?.email).toBe("one@example.invalid");
    expect(p?.roles).toEqual(["student"]);
    expect(p?.entitlementsSyncedAt).toBeTruthy();

    await db.insert(enrollment).values({
      personId: p!.id,
      courseId: c2,
      source: "manual",
      status: "active",
    });

    const second = payload({
      enrollments: [
        {
          external_id: "ext-u-1",
          course: "c1",
          valid_until: "2027-01-31T23:00:00Z",
        },
        { external_id: "ext-u-1b", course: "c2", status: "expired" },
      ],
    });
    expect((await handle(second, headers(second))).status).toBe(200);
    const rows = await db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    expect(
      rows
        .map(
          (r) =>
            `${r.source}:${r.courseId === c1 ? "c1" : "c2"}:${r.externalId ?? ""}:${r.status}:${r.validUntil?.toISOString() ?? ""}`,
        )
        .sort(),
    ).toEqual([
      "manual:c2::active:",
      "webhook:c1:ext-u-1:active:2027-01-31T23:00:00.000Z",
      "webhook:c2:ext-u-1b:expired:",
    ]);

    // A full-state payload without ext-u-1b revokes it; the manual row is still untouched.
    const third = payload({ enrollments: [{ external_id: "ext-u-1", course: "c1" }] });
    expect((await handle(third, headers(third))).status).toBe(200);
    const after = await db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    const byKey = Object.fromEntries(
      after.map((r) => [`${r.source}:${r.externalId ?? ""}`, r.status]),
    );
    expect(byKey).toEqual({
      "manual:": "active",
      "webhook:ext-u-1": "active",
      "webhook:ext-u-1b": "revoked",
    });
    expect(after.find((r) => r.externalId === "ext-u-1")?.validUntil).toBeNull();
  });
  it("updates the row in place when the external id is stable", async () => {
    const body = payload({ sub: "u-5", email: "five@example.invalid", name: "Five" });
    await handle(body, headers(body));
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-5"));
    const [before] = await db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    const moved = payload({
      sub: "u-5",
      email: "five@example.invalid",
      name: "Five",
      enrollments: [{ external_id: "ext-u-5", course: "c2", status: "revoked" }],
    });
    expect((await handle(moved, headers(moved))).status).toBe(200);
    const rows = await db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before!.id);
    expect(rows[0]).toMatchObject({ courseId: c2, status: "revoked" });
  });
  it("skips enrollments that name an unknown course", async () => {
    const body = payload({
      sub: "u-6",
      email: "six@example.invalid",
      name: "Six",
      enrollments: [{ external_id: "ext-x", course: "no-such-course" }],
    });
    expect((await handle(body, headers(body))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-6"));
    expect(await db.select().from(enrollment).where(eq(enrollment.personId, p!.id))).toHaveLength(
      0,
    );
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
  it("applies role changes at once and maps the brief's role names", async () => {
    const mk = (roles: string[]) =>
      payload({ sub: "u-3", email: "three@example.invalid", name: "Three", roles });
    await handle(mk(["learner"]), headers(mk(["learner"])));
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-3"));
    expect(p?.roles).toEqual(["student"]);
    const promoted = mk(["learner", "instructor", "bogus"]);
    await handle(promoted, headers(promoted));
    const [q] = await db.select().from(person).where(eq(person.externalSub, "u-3"));
    expect(q?.roles).toEqual(["student", "teacher"]);
  });
  it("adopts an existing person with the same email without touching their roles", async () => {
    const [local] = await db
      .insert(person)
      .values({ email: "local@example.invalid", name: "Local", roles: ["admin"] })
      .returning({ id: person.id });
    const body = payload({ sub: "u-adopt", email: "Local@Example.invalid", roles: [] });
    expect((await handle(body, headers(body))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.id, local!.id));
    expect(p?.externalSub).toBe("u-adopt");
    expect(p?.roles).toEqual(["admin"]);
  });
  it("resolves courses and cohorts by external_ref as well as slug", async () => {
    const [c] = await db
      .insert(course)
      .values({ slug: "c-ref", externalRef: "crm-course-9", title: "C", language: "en" })
      .returning({ id: course.id });
    await db
      .insert(cohort)
      .values({ courseId: c!.id, slug: "g-ref", externalRef: "crm-cohort-9", title: "G" });
    const body = payload({
      sub: "u-ref",
      email: "ref@example.invalid",
      enrollments: [{ external_id: "ext-ref", course: "crm-course-9", cohort: "crm-cohort-9" }],
    });
    expect((await handle(body, headers(body))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-ref"));
    const rows = await db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.courseId).toBe(c!.id);
    expect(rows[0]?.cohortId).toBeTruthy();
  });
  it("places the person in the cohort of a cohort-scoped enrollment", async () => {
    const [c] = await db
      .insert(course)
      .values({ slug: "c-webhook", title: "C", language: "en" })
      .returning({ id: course.id });
    await db.insert(cohort).values({ courseId: c!.id, slug: "group-a", title: "Group A" });
    const mk = () =>
      payload({
        sub: "u-4",
        email: "four@example.invalid",
        name: "Four",
        enrollments: [{ external_id: "ext-u-4", course: "c-webhook", cohort: "group-a" }],
      });
    const body = mk();
    expect((await handle(body, headers(body))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-4"));
    const members = await db.select().from(cohortMember).where(eq(cohortMember.personId, p!.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("student");
    const [row] = await db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    expect(row?.cohortId).toBe(members[0]?.cohortId);
    // A repeat is idempotent.
    const again = mk();
    await handle(again, headers(again));
    expect(
      await db.select().from(cohortMember).where(eq(cohortMember.personId, p!.id)),
    ).toHaveLength(1);
    expect(await db.select().from(enrollment).where(eq(enrollment.personId, p!.id))).toHaveLength(
      1,
    );
  });
  it("skips a cohort that belongs to another course", async () => {
    const body = payload({
      sub: "u-7",
      email: "seven@example.invalid",
      name: "Seven",
      enrollments: [{ external_id: "ext-u-7", course: "c1", cohort: "group-a" }],
    });
    expect((await handle(body, headers(body))).status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.externalSub, "u-7"));
    expect(await db.select().from(enrollment).where(eq(enrollment.personId, p!.id))).toHaveLength(
      0,
    );
  });
});
