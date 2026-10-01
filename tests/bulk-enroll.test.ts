/**
 * Manual enrollment by email list and by cohort, and the drip rule generator, on PGlite. The core
 * functions take the actor and the auth mode as data; the server functions only authorise and wrap.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("../src/server/services/email/mailer.ts", () => ({ sendMail: async () => {} }));
process.env.APP_URL = "http://localhost:3003";

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const s = await import("../src/db/schema.ts");
const { enrollEmails, enrollCohortMembers } =
  await import("../src/server/mutations/enrollments-core.ts");
const { applyDripRule } = await import("../src/server/mutations/cohorts-core.ts");

let actor: { id: string; name: string };
let courseId: string;
let otherCourseId: string;
let cohortId: string;
let chapterIds: string[];

beforeAll(async () => {
  await runMigrations();
  const [a] = await db
    .insert(s.person)
    .values({ email: "admin@example.invalid", name: "Admin", roles: ["admin"] })
    .returning();
  actor = { id: a!.id, name: a!.name };
  const [c] = await db
    .insert(s.course)
    .values({ slug: "bulk", title: "Bulk", language: "en", status: "published" })
    .returning();
  const [o] = await db
    .insert(s.course)
    .values({ slug: "bulk-other", title: "Other", language: "en", status: "published" })
    .returning();
  courseId = c!.id;
  otherCourseId = o!.id;
  const [g] = await db
    .insert(s.cohort)
    .values({ courseId, slug: "bulk-cohort", title: "G", startsAt: "2026-09-01" })
    .returning();
  cohortId = g!.id;
  const chs = await db
    .insert(s.chapter)
    .values([1, 2, 3].map((n) => ({ courseId, slug: `c${n}`, title: `C${n}`, sort: n })))
    .returning();
  chapterIds = chs.sort((x, y) => x.sort - y.sort).map((x) => x.id);
});

const enrollmentsOf = (email: string, cid = courseId) =>
  db
    .select({ e: s.enrollment })
    .from(s.enrollment)
    .innerJoin(s.person, eq(s.person.id, s.enrollment.personId))
    .where(and(eq(s.person.email, email), eq(s.enrollment.courseId, cid)))
    .then((r) => r.map((x) => x.e));

describe("enrollEmails", () => {
  it("local mode: enrolls known people and invites unknown addresses", async () => {
    await db.insert(s.person).values({ email: "known@example.invalid", name: "Known" });
    const res = await db.transaction((tx) =>
      enrollEmails(tx, actor, {
        authMode: "local",
        courseId,
        cohortId: null,
        text: "known@example.invalid, new@example.invalid\nbroken@",
      }),
    );
    expect(res.results).toEqual([
      { email: "known@example.invalid", outcome: "enrolled" },
      { email: "new@example.invalid", outcome: "invited" },
    ]);
    expect(res.invalid).toEqual(["broken@"]);
    const [created] = await db
      .select()
      .from(s.person)
      .where(eq(s.person.email, "new@example.invalid"));
    expect(created).toMatchObject({ roles: ["student"], externalSub: null });
    const inv = await db.select().from(s.invitation).where(eq(s.invitation.personId, created!.id));
    expect(inv).toHaveLength(1);
    expect(await enrollmentsOf("new@example.invalid")).toMatchObject([
      { source: "manual", status: "active" },
    ]);
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "enrollment.bulk"));
    expect(log).toHaveLength(1);
  });

  it("oidc mode: creates a placeholder person with no sub and no invitation", async () => {
    const res = await db.transaction((tx) =>
      enrollEmails(tx, actor, {
        authMode: "oidc",
        courseId,
        cohortId: null,
        text: "Waiting@Example.invalid",
      }),
    );
    expect(res.results).toEqual([{ email: "waiting@example.invalid", outcome: "placeholder" }]);
    const [p] = await db
      .select()
      .from(s.person)
      .where(eq(s.person.email, "waiting@example.invalid"));
    expect(p).toMatchObject({ externalSub: null, externalIss: null, roles: ["student"] });
    expect(
      await db.select().from(s.invitation).where(eq(s.invitation.personId, p!.id)),
    ).toHaveLength(0);
    expect(await enrollmentsOf("waiting@example.invalid")).toHaveLength(1);
  });

  it("is idempotent and reports people who were already enrolled", async () => {
    const res = await db.transaction((tx) =>
      enrollEmails(tx, actor, {
        authMode: "oidc",
        courseId,
        cohortId: null,
        text: "waiting@example.invalid",
      }),
    );
    expect(res.results).toEqual([{ email: "waiting@example.invalid", outcome: "already" }]);
    expect(await enrollmentsOf("waiting@example.invalid")).toHaveLength(1);
  });

  it("placing in a cohort also makes them a student member", async () => {
    await db.transaction((tx) =>
      enrollEmails(tx, actor, {
        authMode: "oidc",
        courseId,
        cohortId,
        text: "l1@example.invalid l2@example.invalid l3@example.invalid",
      }),
    );
    const members = await db
      .select()
      .from(s.cohortMember)
      .where(eq(s.cohortMember.cohortId, cohortId));
    expect(members).toHaveLength(3);
    expect(members.every((m) => m.role === "student")).toBe(true);
  });

  it("matches a stored address case-insensitively instead of creating a duplicate person", async () => {
    await db.insert(s.person).values({ email: "Mixed.Case@Example.invalid", name: "Mixed" });
    const res = await db.transaction((tx) =>
      enrollEmails(tx, actor, {
        authMode: "oidc",
        courseId,
        cohortId: null,
        text: "MIXED.case@example.invalid",
      }),
    );
    expect(res.results).toEqual([{ email: "mixed.case@example.invalid", outcome: "enrolled" }]);
    const people = await db.execute(
      sql`select id from person where lower(email) = 'mixed.case@example.invalid'`,
    );
    expect(people.rows).toHaveLength(1);
  });

  it("a changed validity window is a change, not 'already'", async () => {
    const run = (extra: { validFrom?: Date; validUntil?: Date | null }) =>
      db.transaction((tx) =>
        enrollEmails(tx, actor, {
          authMode: "oidc",
          courseId,
          cohortId: null,
          text: "window@example.invalid",
          ...extra,
        }),
      );
    const from1 = new Date("2026-01-01T00:00:00Z");
    const from2 = new Date("2026-02-01T00:00:00Z");
    expect((await run({ validFrom: from1 })).results[0]!.outcome).toBe("placeholder");
    expect((await run({ validFrom: from1 })).results[0]!.outcome).toBe("already");
    expect((await run({})).results[0]!.outcome).toBe("already");
    expect((await run({ validFrom: from2 })).results[0]!.outcome).toBe("enrolled");
    expect(
      (await run({ validFrom: from2, validUntil: new Date("2027-01-01") })).results[0]!.outcome,
    ).toBe("enrolled");
    expect((await run({ validFrom: from2, validUntil: null })).results[0]!.outcome).toBe(
      "enrolled",
    );
    expect((await run({ validFrom: from2, validUntil: null })).results[0]!.outcome).toBe("already");
  });

  it("rejects an oversized list", async () => {
    const text = Array.from({ length: 501 }, (_, i) => `u${i}@example.invalid`).join(" ");
    await expect(
      db.transaction((tx) =>
        enrollEmails(tx, actor, { authMode: "oidc", courseId, cohortId: null, text }),
      ),
    ).rejects.toThrow(/at most/);
  });
});

describe("enrollCohortMembers", () => {
  it("enrolls the cohort's students into another course, course-wide", async () => {
    const res = await db.transaction((tx) =>
      enrollCohortMembers(tx, actor, { cohortId, targetCourseId: otherCourseId }),
    );
    expect(res.enrolled).toBe(3);
    const rows = await enrollmentsOf("l2@example.invalid", otherCourseId);
    expect(rows).toMatchObject([{ cohortId: null, source: "manual", status: "active" }]);
  });
  it("repairs the cohort's own course with cohort-scoped rows, skipping teachers", async () => {
    const [t] = await db
      .insert(s.person)
      .values({ email: "teach@example.invalid", name: "T", roles: ["teacher"] })
      .returning();
    await db.insert(s.cohortMember).values({ cohortId, personId: t!.id, role: "teacher" });
    const res = await db.transaction((tx) =>
      enrollCohortMembers(tx, actor, { cohortId, targetCourseId: courseId }),
    );
    expect(res.enrolled).toBe(3);
    expect(await enrollmentsOf("teach@example.invalid")).toHaveLength(0);
  });
});

describe("applyDripRule", () => {
  it("writes one chapter release per step from the cohort start and replaces on re-apply", async () => {
    const rows = await db.transaction((tx) =>
      applyDripRule(tx, actor, { cohortId, everyDays: 7, chaptersPerStep: 1, startDate: null }),
    );
    expect(rows).toHaveLength(3);
    const stored = await db
      .select()
      .from(s.cohortRelease)
      .where(eq(s.cohortRelease.cohortId, cohortId));
    expect(stored).toHaveLength(3);
    const byChapter = new Map(stored.map((r) => [r.chapterId, r.releaseAt]));
    const day = (id: string) => byChapter.get(id)!.getTime();
    expect(day(chapterIds[1]!) - day(chapterIds[0]!)).toBe(7 * 24 * 3600 * 1000);

    await db.transaction((tx) =>
      applyDripRule(tx, actor, {
        cohortId,
        everyDays: 14,
        chaptersPerStep: 2,
        startDate: "2026-10-01",
      }),
    );
    const again = await db
      .select()
      .from(s.cohortRelease)
      .where(eq(s.cohortRelease.cohortId, cohortId));
    expect(again).toHaveLength(3);
    const log = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, "cohort.release.drip"));
    expect(log).toHaveLength(2);
  });
  it("needs a start date from the cohort or the call", async () => {
    const [g] = await db
      .insert(s.cohort)
      .values({ courseId, slug: "no-start", title: "No start" })
      .returning();
    await expect(
      db.transaction((tx) =>
        applyDripRule(tx, actor, {
          cohortId: g!.id,
          everyDays: 7,
          chaptersPerStep: 1,
          startDate: null,
        }),
      ),
    ).rejects.toThrow(/start date/);
  });
});
