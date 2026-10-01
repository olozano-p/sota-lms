/**
 * The service API (`/api/v1`) on the in-memory PGlite: authentication, the HMAC signature,
 * idempotent enrollment upserts and revocation, placeholder people, and the guarantee that
 * `manual` and `claims` rows are never touched. Calls go through the same dispatcher the route uses.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const TOKEN = "t".repeat(40);
const SECRET = "hmac-secret-for-tests";
const ORIGIN = "http://localhost:3003";

process.env.AUTH_MODE = "oidc";
process.env.APP_URL = ORIGIN;
process.env.OIDC_ISSUER = "http://127.0.0.1:1";
process.env.OIDC_CLIENT_ID = "sota";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.API_SERVICE_TOKEN = TOKEN;

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const schema = await import("../src/db/schema.ts");
const { resetEnvCache } = await import("../src/config/env.ts");
const { handleApiV1 } = await import("../src/server/api/v1/dispatch.ts");
const { routes } = await import("../src/server/api/v1/routes.ts");
const { signServiceRequest } = await import("../src/server/auth/service.ts");
const { person, enrollment, course, cohort, cohortMember, auditLog, lessonProgress } = schema;

interface CallOptions {
  body?: unknown;
  raw?: string;
  token?: string | null;
  sign?: boolean | { secret?: string; ts?: number; method?: string; path?: string };
}

/** Calls the API like a client; signs the request when a secret is configured and `sign` is not false. */
async function api(method: string, path: string, opts: CallOptions = {}) {
  const raw = opts.raw ?? (opts.body === undefined ? "" : JSON.stringify(opts.body));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? TOKEN}`;
  const url = `${ORIGIN}/api/v1${path}`;
  const sign = opts.sign ?? (process.env.WEBHOOK_HMAC_SECRET ? true : false);
  if (sign) {
    const o = typeof sign === "object" ? sign : {};
    const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    headers["x-timestamp"] = ts;
    headers["x-signature"] = signServiceRequest(
      o.secret ?? SECRET,
      ts,
      o.method ?? method,
      o.path ?? new URL(url).pathname,
      raw,
    );
  }
  const res = await handleApiV1(
    new Request(url, { method, headers, body: method === "GET" ? undefined : raw }),
  );
  const json = (await res.json()) as any;
  // Every answer must match the schema the OpenAPI document publishes for it.
  const def = routes.find(
    (r) =>
      r.method === method.toLowerCase() &&
      new RegExp(`^${r.path.replace(/\{\w+\}/g, "[^/]+")}$`).test(new URL(url).pathname.slice(7)),
  );
  const schemaFor = def?.responses[res.status]?.schema;
  if (schemaFor) expect(schemaFor.safeParse(json).success, JSON.stringify(json)).toBe(true);
  return { status: res.status, json, headers: res.headers };
}

const put = (id: string, body: unknown, o: CallOptions = {}) =>
  api("PUT", `/enrollments/${id}`, { body, ...o });
const del = (id: string, o: CallOptions = {}) => api("DELETE", `/enrollments/${id}`, o);

let c1: string;
let c2: string;
let g1: string;

beforeAll(async () => {
  await runMigrations(db);
  const courses = await db
    .insert(course)
    .values([
      {
        slug: "intro",
        externalRef: "crs-100",
        title: "Intro",
        language: "en",
        status: "published",
      },
      { slug: "advanced", title: "Advanced", language: "en", status: "published" },
    ])
    .returning({ id: course.id, slug: course.slug });
  c1 = courses.find((c) => c.slug === "intro")!.id;
  c2 = courses.find((c) => c.slug === "advanced")!.id;
  const [g] = await db
    .insert(cohort)
    .values({ courseId: c1, slug: "autumn", externalRef: "coh-1", title: "Autumn" })
    .returning({ id: cohort.id });
  g1 = g!.id;
});

beforeEach(() => {
  process.env.API_SERVICE_TOKEN = TOKEN;
  delete process.env.WEBHOOK_HMAC_SECRET;
  process.env.AUTH_MODE = "oidc";
  resetEnvCache();
});

const rowsOf = (externalId: string) =>
  db.select().from(enrollment).where(eq(enrollment.externalId, externalId));

describe("availability and token", () => {
  it("is 404 everywhere except /health while API_SERVICE_TOKEN is empty", async () => {
    process.env.API_SERVICE_TOKEN = "";
    resetEnvCache();
    expect((await api("GET", "/courses")).status).toBe(404);
    expect((await api("GET", "/openapi.json", { token: null })).status).toBe(404);
    expect((await put("x", { user: { email: "a@example.invalid" }, course: "intro" })).status).toBe(
      404,
    );
    const health = await api("GET", "/health", { token: null });
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ status: "ok", db: "ok" });
  });

  it("answers 401 to a missing or wrong token and 200 to the right one", async () => {
    const none = await api("GET", "/courses", { token: null });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await api("GET", "/courses", { token: "w".repeat(40) })).status).toBe(401);
    expect((await api("GET", "/courses", { token: TOKEN.slice(0, -1) })).status).toBe(401);
    const ok = await api("GET", "/courses");
    expect(ok.status).toBe(200);
    expect(ok.json.data.map((c: any) => c.slug).sort()).toEqual(["advanced", "intro"]);
    expect(ok.json.data.find((c: any) => c.slug === "intro")).toEqual({
      slug: "intro",
      external_ref: "crs-100",
      title: "Intro",
      status: "published",
    });
  });

  it("serves health and the OpenAPI document without a token when enabled", async () => {
    expect((await api("GET", "/health", { token: null })).status).toBe(200);
    const doc = await api("GET", "/openapi.json", { token: null });
    expect(doc.status).toBe(200);
    expect(doc.json.openapi).toBe("3.1.0");
  });

  it("answers 405 with Allow for a known path and 404 for an unknown one", async () => {
    const r = await api("POST", "/enrollments/x", { body: {} });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("PUT, DELETE");
    expect((await api("GET", "/nothing-here")).status).toBe(404);
  });
});

describe("HMAC signature", () => {
  beforeEach(() => {
    process.env.WEBHOOK_HMAC_SECRET = SECRET;
    resetEnvCache();
  });
  const body = { user: { email: "sig@example.invalid" }, course: "intro" };

  it("is required once the secret is set", async () => {
    const r = await put("sig-1", body, { sign: false });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("invalid_signature");
    expect(await rowsOf("sig-1")).toHaveLength(0);
  });
  it("rejects a bad signature, a wrong secret and a tampered body", async () => {
    expect((await put("sig-1", body, { sign: { secret: "other-secret" } })).status).toBe(401);
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await handleApiV1(
      new Request(`${ORIGIN}/api/v1/enrollments/sig-1`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-timestamp": ts,
          "x-signature": signServiceRequest(SECRET, ts, "PUT", "/api/v1/enrollments/sig-1", raw),
        },
        body: raw.replace("intro", "advanced"),
      }),
    );
    expect(res.status).toBe(401);
    expect(await rowsOf("sig-1")).toHaveLength(0);
  });
  it("rejects a stale or future timestamp even with a correct signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const ts of [now - 6 * 60, now + 6 * 60]) {
      const r = await put("sig-1", body, { sign: { ts } });
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe("stale_timestamp");
    }
    expect((await put("sig-1", body, { sign: { ts: now - 4 * 60 } })).status).toBe(201);
  });
  it("binds the signature to the method and the path", async () => {
    expect((await del("sig-1", { sign: { method: "PUT" } })).status).toBe(401);
    expect((await del("sig-1", { sign: { path: "/api/v1/enrollments/other" } })).status).toBe(401);
    expect((await del("sig-1")).status).toBe(200);
  });
  it("is checked after the token, so a wrong token never reveals the signature rule", async () => {
    const r = await put("sig-1", body, { token: "w".repeat(40), sign: false });
    expect(r.json.error.code).toBe("unauthorized");
  });
  it("leaves health and the document unsigned", async () => {
    expect((await api("GET", "/health", { token: null, sign: false })).status).toBe(200);
  });
});

describe("PUT /enrollments/{external_id}", () => {
  it("creates, then repeats without changing anything or writing another audit row", async () => {
    const body = {
      user: { sub: "sub-idem", email: "Idem@Example.invalid" },
      course: "intro",
      valid_until: "2027-06-30T22:00:00Z",
    };
    const first = await put("idem-1", body);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({
      created: true,
      changed: true,
      enrollment: {
        external_id: "idem-1",
        course: { slug: "intro", external_ref: "crs-100" },
        cohort: null,
        status: "active",
        valid_until: "2027-06-30T22:00:00.000Z",
        user: { sub: "sub-idem", email: "idem@example.invalid", pending: true },
      },
    });
    const [row] = await rowsOf("idem-1");
    const again = await put("idem-1", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ created: false, changed: false });
    expect(again.json.enrollment.valid_from).toBe(first.json.enrollment.valid_from);
    expect(await rowsOf("idem-1")).toEqual([row]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row!.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "enrollment.service_put", actorPersonId: null });
    expect((audits[0]!.diff as any).actor).toBe("service:api");
  });

  it("updates the window and reports the change", async () => {
    const base = { user: { email: "upd@example.invalid" }, course: "intro" };
    await put("upd-1", base);
    const r = await put("upd-1", { ...base, valid_until: "2030-01-01T00:00:00Z" });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(true);
    expect((await rowsOf("upd-1"))[0]!.validUntil?.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    // PUT replaces: leaving valid_until out makes it open-ended again.
    await put("upd-1", base);
    expect((await rowsOf("upd-1"))[0]!.validUntil).toBeNull();
  });

  it("reactivates after DELETE and keeps one row", async () => {
    const body = { user: { email: "re@example.invalid" }, course: "advanced" };
    await put("re-1", body);
    const gone = await del("re-1");
    expect(gone.json).toEqual({
      external_id: "re-1",
      found: true,
      changed: true,
      status: "revoked",
    });
    expect((await rowsOf("re-1"))[0]!.status).toBe("revoked");
    const back = await put("re-1", body);
    expect(back.status).toBe(200);
    expect(back.json).toMatchObject({ created: false, changed: true });
    expect(back.json.enrollment.status).toBe("active");
    expect(await rowsOf("re-1")).toHaveLength(1);
  });

  it("re-keys a revoked row when the same slot comes back under a new external_id", async () => {
    const user = { email: "renew@example.invalid" };
    await put("renew-1", { user, course: "advanced" });
    await del("renew-1");
    const renewed = await put("renew-2", { user, course: "advanced" });
    expect(renewed.status).toBe(200);
    expect(renewed.json).toMatchObject({ created: false, changed: true });
    expect(await rowsOf("renew-1")).toHaveLength(0);
    const [row] = await rowsOf("renew-2");
    expect(row).toMatchObject({ status: "active", source: "webhook" });
    // While that row is active a third id for the slot is refused.
    expect((await put("renew-3", { user, course: "advanced" })).status).toBe(409);
  });

  it("is safe under concurrent identical calls: one row, one creation", async () => {
    const body = { user: { sub: "sub-race" }, course: "intro", cohort: "autumn" };
    const results = await Promise.all(Array.from({ length: 6 }, () => put("race-1", body)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    expect(await rowsOf("race-1")).toHaveLength(1);
    expect(await db.select().from(person).where(eq(person.externalSub, "sub-race"))).toHaveLength(
      1,
    );
  });

  it("is safe under concurrent calls for different external ids of one new user", async () => {
    const results = await Promise.all(
      ["race-a", "race-b", "race-c"].map((id, i) =>
        put(id, {
          user: { email: "multi@example.invalid" },
          course: i === 0 ? "intro" : "advanced",
        }),
      ),
    );
    // race-b and race-c both target "advanced": exactly one wins, the other is a duplicate.
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 201, 409]);
    expect(
      await db.select().from(person).where(eq(person.email, "multi@example.invalid")),
    ).toHaveLength(1);
  });

  it("resolves the course and cohort by external_ref and places the user in the cohort", async () => {
    const r = await put("coh-1", {
      user: { email: "coh@example.invalid" },
      course: "crs-100",
      cohort: "coh-1",
    });
    expect(r.status).toBe(201);
    expect(r.json.enrollment.cohort).toEqual({ slug: "autumn", external_ref: "coh-1" });
    const [p] = await db.select().from(person).where(eq(person.email, "coh@example.invalid"));
    expect(
      await db.select().from(cohortMember).where(eq(cohortMember.personId, p!.id)),
    ).toMatchObject([{ cohortId: g1, role: "student" }]);
  });

  it("answers 404 for an unknown course or cohort and writes nothing", async () => {
    const before = await db.select().from(person);
    const course404 = await put("bad-1", {
      user: { email: "ghost@example.invalid" },
      course: "nope",
    });
    expect(course404.status).toBe(404);
    expect(course404.json.error.code).toBe("course_not_found");
    const cohort404 = await put("bad-1", {
      user: { email: "ghost@example.invalid" },
      course: "intro",
      cohort: "nope",
    });
    expect(cohort404.json.error.code).toBe("cohort_not_found");
    const mismatch = await put("bad-1", {
      user: { email: "ghost@example.invalid" },
      course: "advanced",
      cohort: "autumn",
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.json.error.code).toBe("cohort_course_mismatch");
    expect(await rowsOf("bad-1")).toHaveLength(0);
    expect(await db.select().from(person)).toHaveLength(before.length);
  });

  it("validates the body", async () => {
    const noUser = await put("v-1", { user: {}, course: "intro" });
    expect(noUser.status).toBe(422);
    expect(noUser.json.error.issues[0].message).toContain("user.sub or user.email");
    expect((await put("v-1", { user: { sub: "s" } })).status).toBe(422);
    expect(
      (await put("v-1", { user: { sub: "s" }, course: "intro", valid_until: "tomorrow" })).status,
    ).toBe(422);
    expect(
      (
        await put("v-1", {
          user: { sub: "s" },
          course: "intro",
          valid_from: "2027-01-01T00:00:00Z",
          valid_until: "2026-01-01T00:00:00Z",
        })
      ).status,
    ).toBe(422);
    expect((await put("v-1", null, { raw: "{not json" })).status).toBe(400);
    const big = await put("v-1", null, { raw: JSON.stringify({ pad: "x".repeat(70_000) }) });
    expect(big.status).toBe(413);
  });

  it("refuses to move an external_id to another user and to duplicate a course slot", async () => {
    await put("own-1", { user: { email: "owner@example.invalid" }, course: "intro" });
    const moved = await put("own-1", { user: { email: "thief@example.invalid" }, course: "intro" });
    expect(moved.status).toBe(409);
    expect(moved.json.error.code).toBe("external_id_conflict");
    expect(
      await db.select().from(person).where(eq(person.email, "thief@example.invalid")),
    ).toHaveLength(0);
    const dup = await put("own-2", { user: { email: "owner@example.invalid" }, course: "intro" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate_enrollment");
    expect(await rowsOf("own-2")).toHaveLength(0);
  });
});

describe("people", () => {
  it("creates a placeholder keyed by sub alone, with a made-up address that never gets mail", async () => {
    const r = await put("ph-sub", { user: { sub: "sub-only" }, course: "intro" });
    expect(r.status).toBe(201);
    const [p] = await db.select().from(person).where(eq(person.externalSub, "sub-only"));
    expect(p).toMatchObject({ name: "sub-only", roles: ["student"], emailOptOut: true });
    expect(p!.email).toMatch(/^u-[0-9a-f]{24}@placeholder\.invalid$/);
    expect(p!.externalIss).toBeNull();
    expect(p!.lastSeenAt).toBeNull();
    expect(r.json.enrollment.user.pending).toBe(true);
    // The same sub again reuses the placeholder.
    await put("ph-sub-2", { user: { sub: "sub-only" }, course: "advanced" });
    expect(await db.select().from(person).where(eq(person.externalSub, "sub-only"))).toHaveLength(
      1,
    );
  });

  it("creates a placeholder by email, with the sub when given", async () => {
    await put("ph-mail", {
      user: { sub: "sub-mail", email: "Waiting@Example.invalid", name: "Waiting" },
      course: "intro",
    });
    const [p] = await db.select().from(person).where(eq(person.email, "waiting@example.invalid"));
    expect(p).toMatchObject({ externalSub: "sub-mail", name: "Waiting", emailOptOut: false });
  });

  it("adopts a known person by email and gives them the sub", async () => {
    const [known] = await db
      .insert(person)
      .values({ email: "known@example.invalid", name: "Known", roles: ["teacher"] })
      .returning();
    await put("known-1", {
      user: { sub: "sub-known", email: "KNOWN@example.invalid" },
      course: "intro",
    });
    const [after] = await db.select().from(person).where(eq(person.id, known!.id));
    expect(after).toMatchObject({ externalSub: "sub-known", roles: ["teacher"], name: "Known" });
    const conflict = await put("known-2", {
      user: { sub: "another-sub", email: "known@example.invalid" },
      course: "advanced",
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("identity_conflict");
  });

  it("does not register anyone in local mode, but enrolls people who exist", async () => {
    process.env.AUTH_MODE = "local";
    delete process.env.OIDC_ISSUER;
    resetEnvCache();
    try {
      const unknown = await put("loc-1", {
        user: { email: "nobody@example.invalid" },
        course: "intro",
      });
      expect(unknown.status).toBe(404);
      expect(unknown.json.error.code).toBe("user_not_found");
      await db.insert(person).values({ email: "local@example.invalid", name: "Local" });
      const known = await put("loc-2", {
        user: { email: "local@example.invalid" },
        course: "intro",
      });
      expect(known.status).toBe(201);
    } finally {
      process.env.OIDC_ISSUER = "http://127.0.0.1:1";
    }
  });
});

describe("rows of other sources", () => {
  it("never touches manual or claims enrollments, whatever the service sends", async () => {
    const [p] = await db
      .insert(person)
      .values({ email: "mixed@example.invalid", name: "Mixed", externalSub: "sub-mixed" })
      .returning();
    const [manual, claims] = await db
      .insert(enrollment)
      .values([
        { personId: p!.id, courseId: c1, source: "manual", validUntil: new Date("2031-01-01") },
        { personId: p!.id, courseId: c1, cohortId: g1, source: "claims", externalId: "mix-claims" },
      ])
      .returning();
    const snapshot = async () =>
      (await db.select().from(enrollment).where(eq(enrollment.personId, p!.id))).filter(
        (r) => r.source !== "webhook",
      );
    const before = await snapshot();

    const r = await put("mix-1", { user: { sub: "sub-mixed" }, course: "intro" });
    expect(r.status).toBe(201);
    // Even an external_id that a claims row carries is a different namespace.
    expect(
      (await put("mix-claims", { user: { sub: "sub-mixed" }, course: "advanced" })).status,
    ).toBe(201);
    await del("mix-1");
    await del("mix-claims");
    expect((await del("unknown-id")).json).toMatchObject({ found: false, changed: false });
    expect(await snapshot()).toEqual(before);
    const webhookRows = await db
      .select()
      .from(enrollment)
      .where(and(eq(enrollment.personId, p!.id), eq(enrollment.source, "webhook")));
    expect(webhookRows.map((w) => w.status)).toEqual(["revoked", "revoked"]);
    expect([manual!.status, claims!.status]).toEqual(["active", "active"]);
  });
});

describe("GET /users/{sub}/progress", () => {
  it("reports completed over published lessons per course, and 404 for an unknown sub", async () => {
    const { chapter, lesson } = schema;
    const [ch] = await db
      .insert(chapter)
      .values({ courseId: c1, slug: "ch", title: "Ch" })
      .returning({ id: chapter.id });
    const ls = await db
      .insert(lesson)
      .values([
        { chapterId: ch!.id, slug: "l1", title: "L1", status: "published", sort: 1 },
        { chapterId: ch!.id, slug: "l2", title: "L2", status: "published", sort: 2 },
        { chapterId: ch!.id, slug: "l3", title: "Draft", status: "draft", sort: 3 },
      ])
      .returning({ id: lesson.id });
    await put("prog-1", {
      user: { sub: "sub-prog", email: "prog@example.invalid" },
      course: "intro",
    });
    const [p] = await db.select().from(person).where(eq(person.externalSub, "sub-prog"));
    const done = new Date("2026-09-30T10:00:00Z");
    await db
      .insert(lessonProgress)
      .values({ personId: p!.id, lessonId: ls[0]!.id, status: "completed", completedAt: done });

    const half = await api("GET", "/users/sub-prog/progress");
    expect(half.status).toBe(200);
    expect(half.json.user).toEqual({
      sub: "sub-prog",
      email: "prog@example.invalid",
      name: "prog@example.invalid",
    });
    expect(half.json.courses).toMatchObject([
      {
        slug: "intro",
        external_ref: "crs-100",
        lessons_total: 2,
        lessons_completed: 1,
        ratio: 0.5,
        completed_at: null,
      },
    ]);
    await db.insert(lessonProgress).values({
      personId: p!.id,
      lessonId: ls[1]!.id,
      status: "completed",
      completedAt: new Date("2026-10-01T09:00:00Z"),
    });
    const full = await api("GET", "/users/sub-prog/progress");
    expect(full.json.courses[0]).toMatchObject({
      ratio: 1,
      completed_at: "2026-10-01T09:00:00.000Z",
    });
    expect((await api("GET", "/users/nobody/progress")).status).toBe(404);
  });
});

describe("course enrollments view", () => {
  it("lists every origin with its external id and whether the person has signed in", async () => {
    const { courseEnrollmentRows } =
      await import("../src/server/queries/course-enrollments-core.ts");
    await put("view-1", { user: { sub: "sub-view" }, course: "advanced" });
    const [p] = await db.select().from(person).where(eq(person.externalSub, "sub-view"));
    await db.insert(enrollment).values({ personId: p!.id, courseId: c2, source: "manual" });
    const { rows, total } = await courseEnrollmentRows(c2);
    expect(total).toBe(rows.length);
    const mine = rows.filter((r) => r.personId === p!.id);
    expect(mine.map((r) => [r.source, r.externalId]).sort()).toEqual([
      ["manual", null],
      ["webhook", "view-1"],
    ]);
    expect(mine.every((r) => r.pending && r.sub === "sub-view")).toBe(true);
  });
});
