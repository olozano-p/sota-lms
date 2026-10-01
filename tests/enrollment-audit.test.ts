/**
 * Every path that writes an `enrollment` row appends an `audit_log` row: the complete-set sync
 * (webhook and pull), the claims sync, the login sync, the manual grant and revoke, the bulk and
 * cohort enrollments, cohort placement and removal, the service API, and the sub-placeholder merge.
 * Single changes carry before/after per row; bulk ones carry a capped per-row list.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";

let caller: import("../src/server/auth/authz.ts").SessionUser;

// Server functions run as plain functions (with their validators); the guards are a switchable caller.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null;
    const builder = {
      validator(s: typeof schema) {
        schema = s;
        return builder;
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return (opts?: { data?: unknown }) =>
          fn({ data: schema ? schema.parse(opts?.data) : opts?.data });
      },
    };
    return builder;
  },
}));
vi.mock("../src/server/services/email/mailer.ts", () => ({ sendMail: async () => {} }));
vi.mock("../src/server/auth/authz.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/auth/authz.ts")>();
  const requireUser = async () => caller;
  const requireRole = async (...roles: Parameters<typeof real.hasRole>[1][]) => {
    if (!real.hasRole(caller, "admin", ...roles)) throw new real.AuthorizationError(403);
    return caller;
  };
  return { ...real, requireUser, requireRole, requireCourseTeacher: async () => requireRole() };
});

const TOKEN = "t".repeat(40);
process.env.AUTH_MODE = "oidc";
process.env.APP_URL = "http://localhost:3003";
process.env.OIDC_ISSUER = "http://127.0.0.1:1";
process.env.OIDC_CLIENT_ID = "sota";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.ENTITLEMENT_CLAIM = "memberships";
process.env.ENTITLEMENTS_PULL_URL = "http://source.invalid/people";
process.env.ENTITLEMENTS_PULL_TOKEN = "pull-token";
process.env.API_SERVICE_TOKEN = TOKEN;

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const s = await import("../src/db/schema.ts");
const { AUDIT_DETAIL_CAP } = await import("../src/server/audit.ts");
const { handleEnrollmentWebhook, signWebhook, syncEnrollments } =
  await import("../src/server/access/enrollments.ts");
const { syncClaimEnrollments } = await import("../src/server/access/claims.ts");
const { completeOidcLogin, adoptSubPlaceholder } = await import("../src/server/auth/identity.ts");
const { grantEnrollment, revokeEnrollment, enrollByEmails, enrollCohort } =
  await import("../src/server/mutations/enrollments.ts");
const { addCohortMember, removeCohortMember, deleteCohort } =
  await import("../src/server/mutations/cohorts.ts");
const { handleApiV1 } = await import("../src/server/api/v1/dispatch.ts");

let c1: string;
let c2: string;
let g1: string;

const SECRET = "audit-webhook-secret";
type Diff = {
  actor?: string;
  before: any;
  after: any;
};
const audits = async (action: string, entityId?: string) => {
  const rows = await db
    .select()
    .from(s.auditLog)
    .where(eq(s.auditLog.action, action))
    .orderBy(desc(s.auditLog.at));
  return rows
    .filter((r) => !entityId || r.entityId === entityId)
    .map((r) => ({ ...r, diff: r.diff as Diff }));
};
const count = async (action: string) => (await audits(action)).length;

const person = async (email: string, extra: Partial<typeof s.person.$inferInsert> = {}) => {
  const [p] = await db
    .insert(s.person)
    .values({ email, name: email.split("@")[0]!, roles: ["student"], ...extra })
    .returning();
  return p!;
};
const asUser = (p: typeof s.person.$inferSelect) => ({
  id: p.id,
  sub: p.externalSub,
  name: p.name,
  email: p.email,
  roles: p.roles as any,
  locale: null,
  sessionId: "s",
});

beforeAll(async () => {
  await runMigrations(db);
  const courses = await db
    .insert(s.course)
    .values([
      { slug: "audit-a", title: "A", language: "en", status: "published" },
      { slug: "audit-b", title: "B", language: "en", status: "published" },
    ])
    .returning();
  c1 = courses.find((c) => c.slug === "audit-a")!.id;
  c2 = courses.find((c) => c.slug === "audit-b")!.id;
  const [g] = await db
    .insert(s.cohort)
    .values({ courseId: c1, slug: "audit-cohort", title: "G" })
    .returning();
  g1 = g!.id;
  const admin = await person("admin@example.invalid", { roles: ["admin"] });
  caller = asUser(admin);
});
afterEach(() => vi.unstubAllGlobals());

describe("complete-set sync (legacy webhook and pull)", () => {
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      version: "enrollments/v1",
      sub: "sync-1",
      email: "sync1@example.invalid",
      name: "Sync One",
      roles: ["student"],
      enrollments: [{ external_id: "sync-e1", course: "audit-a" }],
      ...over,
    });
  const post = (raw: string, eventId: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return handleEnrollmentWebhook(
      raw,
      { timestamp: ts, signature: signWebhook(SECRET, ts, raw), eventId },
      { secret: SECRET },
    );
  };

  it("audits creation, a change and a revocation per row, and nothing for a repeat", async () => {
    expect((await post(body(), "ev-1")).status).toBe(200);
    const [p] = await db.select().from(s.person).where(eq(s.person.externalSub, "sync-1"));
    let rows = await audits("enrollment.sync", p!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorPersonId).toBeNull();
    expect(rows[0]!.diff.actor).toBe("sync:webhook");
    expect(rows[0]!.diff.after.changes).toHaveLength(1);
    expect(rows[0]!.diff.after.changes[0]).toMatchObject({
      op: "created",
      before: null,
      after: { source: "webhook", externalId: "sync-e1", status: "active", courseId: c1 },
    });

    await post(body(), "ev-2");
    expect(await audits("enrollment.sync", p!.id)).toHaveLength(1);

    await post(
      body({
        enrollments: [
          { external_id: "sync-e1", course: "audit-a", valid_until: "2030-01-01T00:00:00Z" },
        ],
      }),
      "ev-3",
    );
    rows = await audits("enrollment.sync", p!.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.diff.after.changes[0]).toMatchObject({
      op: "updated",
      before: { validUntil: null },
      after: { validUntil: "2030-01-01T00:00:00.000Z" },
    });

    await post(body({ enrollments: [] }), "ev-4");
    rows = await audits("enrollment.sync", p!.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.diff.after.changes[0]).toMatchObject({
      op: "revoked",
      before: { status: "active" },
      after: { status: "revoked" },
    });
  });

  it("audits a change to the person alone: a new placeholder, new roles, an adopted sub", async () => {
    const only = (sub: string, email: string, roles: string[]) =>
      body({ sub, email, roles, enrollments: [] });
    await post(only("pr-1", "pr1@example.invalid", ["student"]), "ev-p1");
    const [p] = await db.select().from(s.person).where(eq(s.person.externalSub, "pr-1"));
    let rows = await audits("enrollment.sync", p!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff.after.person).toMatchObject({ personCreated: true });
    await post(only("pr-1", "pr1@example.invalid", ["student"]), "ev-p2");
    expect(await audits("enrollment.sync", p!.id)).toHaveLength(1);
    await post(only("pr-1", "pr1@example.invalid", ["teacher"]), "ev-p3");
    rows = await audits("enrollment.sync", p!.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.diff.after.person).toMatchObject({
      rolesBefore: ["student"],
      rolesAfter: ["teacher"],
    });
    const waiting = await person("pr-adopt@example.invalid");
    await post(only("pr-2", "pr-adopt@example.invalid", ["student"]), "ev-p4");
    expect((await audits("enrollment.sync", waiting.id))[0]!.diff.after.person).toMatchObject({
      adoptedSub: true,
    });
  });

  it("audits the pull channel with its own actor", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          body({
            sub: "pull-1",
            email: "pull1@example.invalid",
            enrollments: [{ external_id: "pull-e1", course: "audit-b" }],
          }),
        ),
    );
    const personId = (await syncEnrollments("pull-1"))!;
    const rows = await audits("enrollment.sync", personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff.actor).toBe("sync:pull");
    expect(rows[0]!.diff.after.channel).toBe("pull");
  });
});

describe("claims sync and the login sync", () => {
  it("audits per row with actor sync:claims", async () => {
    const p = await person("claims@example.invalid");
    const r = await syncClaimEnrollments(p.id, [{ course: "audit-a" }, { course: "audit-b" }]);
    expect(r.created).toBe(2);
    let rows = await audits("enrollment.claims_sync", p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff.actor).toBe("sync:claims");
    expect(rows[0]!.diff.after).toMatchObject({ created: 2, total: 2, truncated: false });
    expect(rows[0]!.diff.after.changes.map((c: any) => c.op)).toEqual(["created", "created"]);

    await syncClaimEnrollments(p.id, [{ course: "audit-a" }]);
    rows = await audits("enrollment.claims_sync", p.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.diff.after.changes[0]).toMatchObject({
      op: "expired",
      before: { status: "active", source: "claims" },
      after: { status: "expired" },
    });
    // Repeat: nothing changed, nothing logged.
    await syncClaimEnrollments(p.id, [{ course: "audit-a" }]);
    expect(await audits("enrollment.claims_sync", p.id)).toHaveLength(2);
  });

  it("audits what a sign-in changes (claims and pull) in one transaction each", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            version: "enrollments/v1",
            sub: "login-1",
            email: "login1@example.invalid",
            name: "Login",
            roles: ["student"],
            enrollments: [{ external_id: "login-e1", course: "audit-b" }],
          }),
        ),
    );
    const p = await person("login1@example.invalid", { externalSub: "login-1" });
    await completeOidcLogin(p.id, {
      sub: "login-1",
      email: "login1@example.invalid",
      name: "Login",
      locale: null,
      roles: ["student"],
      claims: { memberships: [{ course: "audit-a" }] },
    });
    expect(await audits("enrollment.claims_sync", p.id)).toHaveLength(1);
    expect(await audits("enrollment.sync", p.id)).toHaveLength(1);
  });
});

describe("manual enrollment", () => {
  it("audits grant and revoke with before and after", async () => {
    const p = await person("manual@example.invalid");
    const granted = await grantEnrollment({ data: { personId: p.id, courseSlug: "audit-a" } });
    let rows = await audits("enrollment.grant", granted.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorPersonId).toBe(caller.id);
    expect(rows[0]!.diff.before).toBeNull();
    expect(rows[0]!.diff.after).toMatchObject({ source: "manual", status: "active" });

    await revokeEnrollment({ data: { enrollmentId: granted.id } });
    rows = await audits("enrollment.revoke", granted.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff.before).toMatchObject({ status: "active" });
    expect(rows[0]!.diff.after).toMatchObject({ status: "revoked" });
  });

  it("audits a pasted list per row, capped, with outcome counts", async () => {
    const n = AUDIT_DETAIL_CAP + 25;
    const text = Array.from({ length: n }, (_, i) => `bulk${i}@example.invalid`).join("\n");
    const res = await enrollByEmails({ data: { courseId: c1, text } });
    expect(res.results).toHaveLength(n);
    const rows = await audits("enrollment.bulk", c1);
    const last = rows[0]!;
    expect(last.diff.after).toMatchObject({
      total: n,
      truncated: true,
      requested: n,
      outcomes: { placeholder: n },
    });
    expect(last.diff.after.changes).toHaveLength(AUDIT_DETAIL_CAP);
    expect(last.diff.after.changes[0]).toMatchObject({
      op: "created",
      before: null,
      after: { source: "manual", status: "active", courseId: c1 },
      note: { email: "bulk0@example.invalid", outcome: "placeholder" },
    });

    // The same list again changes nothing and says so per row.
    await enrollByEmails({ data: { courseId: c1, text: "bulk0@example.invalid" } });
    const again = (await audits("enrollment.bulk", c1))[0]!;
    expect(again.diff.after.changes[0]).toMatchObject({ op: "unchanged" });
  });

  it("audits enrolling a cohort in another course and cohort placement and removal", async () => {
    const m = await person("member@example.invalid");
    await addCohortMember({ data: { cohortId: g1, email: m.email, role: "student" } });
    const add = (await audits("cohort.member.add", g1))[0]!;
    expect(add.diff.after.enrollment).toMatchObject({
      op: "created",
      after: { source: "manual", cohortId: g1 },
    });

    const res = await enrollCohort({ data: { cohortId: g1, targetCourseId: c2 } });
    expect(res.enrolled).toBe(1);
    const co = (await audits("enrollment.cohort", g1))[0]!;
    expect(co.diff.after).toMatchObject({ count: 1, scoped: false, total: 1 });
    expect(co.diff.after.changes[0]).toMatchObject({ op: "created", after: { courseId: c2 } });

    await removeCohortMember({ data: { cohortId: g1, personId: m.id } });
    const rm = (await audits("cohort.member.remove", g1))[0]!;
    expect(rm.diff.after.changes[0]).toMatchObject({
      op: "revoked",
      before: { status: "active", cohortId: g1 },
      after: { status: "revoked" },
    });
  });

  it("audits the enrollments a deleted cohort takes with it", async () => {
    const [g] = await db
      .insert(s.cohort)
      .values({ courseId: c1, slug: "audit-doomed", title: "Doomed" })
      .returning();
    const p = await person("doomed@example.invalid");
    await db.insert(s.enrollment).values({
      personId: p.id,
      courseId: c1,
      cohortId: g!.id,
      source: "manual",
    });
    await deleteCohort({ data: { cohortId: g!.id } });
    const row = (await audits("cohort.delete", g!.id))[0]!;
    expect(row.diff.after.changes).toHaveLength(1);
    expect(row.diff.after.changes[0]).toMatchObject({
      op: "deleted",
      after: null,
      before: { personId: p.id, cohortId: g!.id },
    });
  });
});

describe("service API", () => {
  const call = (method: string, path: string, body?: unknown) =>
    handleApiV1(
      new Request(`http://localhost:3003/api/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  it("audits PUT and DELETE with before and after, and not a repeat", async () => {
    const put = (until?: string) =>
      call("PUT", "/enrollments/svc-1", {
        user: { sub: "svc-sub", email: "svc@example.invalid", name: "Svc" },
        course: "audit-a",
        ...(until ? { valid_until: until } : {}),
      });
    expect((await put()).status).toBeLessThan(300);
    const [e] = await db.select().from(s.enrollment).where(eq(s.enrollment.externalId, "svc-1"));
    let rows = await audits("enrollment.service_put", e!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff).toMatchObject({
      actor: "service:api",
      before: null,
      after: { source: "webhook", externalId: "svc-1", status: "active" },
    });
    await put();
    expect(await audits("enrollment.service_put", e!.id)).toHaveLength(1);
    await put("2030-01-01T00:00:00Z");
    rows = await audits("enrollment.service_put", e!.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.diff.before.validUntil).toBeNull();
    expect(rows[0]!.diff.after.validUntil).toBe("2030-01-01T00:00:00.000Z");

    expect((await call("DELETE", "/enrollments/svc-1")).status).toBe(200);
    const rev = await audits("enrollment.service_revoke", e!.id);
    expect(rev).toHaveLength(1);
    expect(rev[0]!.diff).toMatchObject({
      actor: "service:api",
      before: { status: "active" },
      after: { status: "revoked" },
    });
  });
});

describe("sub-placeholder merge", () => {
  it("audits the moved rows", async () => {
    const placeholder = await person("u-ph@placeholder.invalid", {
      externalSub: "ph-sub",
      emailOptOut: true,
    });
    await db
      .insert(s.enrollment)
      .values({ personId: placeholder.id, courseId: c1, source: "webhook", externalId: "ph-e1" });
    const real = await person("ph-real@example.invalid");
    expect(await adoptSubPlaceholder(real.id, "ph-sub")).toBe(true);
    const row = (await audits("person.adopt_placeholder", real.id))[0]!;
    expect(row.diff.after).toMatchObject({ enrollmentsMoved: 1, total: 1 });
    expect(row.diff.after.changes[0]).toMatchObject({
      op: "moved",
      before: { personId: placeholder.id },
      after: { personId: real.id },
    });
    expect(
      await db
        .select()
        .from(s.enrollment)
        .where(and(eq(s.enrollment.personId, real.id), eq(s.enrollment.externalId, "ph-e1"))),
    ).toHaveLength(1);
  });
});

it("wrote at least one audit row for every enrollment action above", async () => {
  for (const action of [
    "enrollment.sync",
    "enrollment.claims_sync",
    "enrollment.grant",
    "enrollment.revoke",
    "enrollment.bulk",
    "enrollment.cohort",
    "cohort.member.add",
    "cohort.member.remove",
    "cohort.delete",
    "enrollment.service_put",
    "enrollment.service_revoke",
    "person.adopt_placeholder",
  ])
    expect(await count(action), action).toBeGreaterThan(0);
});
