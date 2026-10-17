/**
 * `sota import-progress` (ADR-023): completions from another LMS land on the right person (signed
 * in, placeholder, or a new placeholder), never downgrade or move a completion, skip what does not
 * exist, write nothing in a dry run, change nothing on a re-run, and follow the placeholder into
 * the signed-in person at the first sign-in.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const s = await import("../src/db/schema.ts");
const { importProgress } = await import("../src/server/mutations/progress-import-core.ts");
const { cliActor } = await import("../src/server/mutations/content-import-core.ts");
const { adoptSubPlaceholder, placeholderEmail } = await import("../src/server/auth/identity.ts");
const { PROGRESS_FORMAT, ProgressFileError, parseProgressFile } =
  await import("../src/lib/progress-file.ts");

const ISSUER = "https://idp.example.invalid";
const OIDC: import("../src/server/mutations/progress-import-core.ts").ProgressImportOptions = {
  dryRun: false,
  authMode: "oidc",
  issuer: ISSUER,
};
const lessonIds = new Map<string, string>();

/** A progress file as the producer writes it: one JSON object per line. */
const file = (...records: Record<string, unknown>[]) =>
  records
    .map((r) => JSON.stringify({ format: PROGRESS_FORMAT, version: 1, course: "prog", ...r }))
    .join("\n");
const done = (lesson: string, at: string, chapter = "ch1") => ({
  chapter,
  lesson,
  completed_at: at,
});
const run = (text: string, opts: Partial<typeof OIDC> = {}) =>
  importProgress(db, cliActor(), parseProgressFile(text), { ...OIDC, ...opts });

const personBy = async (where: { email?: string; sub?: string }) =>
  (
    await db
      .select()
      .from(s.person)
      .where(where.email ? eq(s.person.email, where.email) : eq(s.person.externalSub, where.sub!))
  )[0] ?? null;
const progressOf = async (personId: string) =>
  new Map(
    (await db.select().from(s.lessonProgress).where(eq(s.lessonProgress.personId, personId))).map(
      (r) => [[...lessonIds].find(([, id]) => id === r.lessonId)![0], r],
    ),
  );
const imports = async () =>
  db.select().from(s.auditLog).where(eq(s.auditLog.action, "progress.import"));

beforeAll(async () => {
  await runMigrations(db);
  const [c] = await db
    .insert(s.course)
    .values({
      slug: "prog",
      externalRef: "old-lms-42",
      title: "P",
      language: "en",
      status: "published",
    })
    .returning();
  for (const [chSlug, lessons] of [
    ["ch1", ["l1", "l2", "l3"]],
    ["ch2", ["l1"]],
  ] as const) {
    const [ch] = await db
      .insert(s.chapter)
      .values({ courseId: c!.id, slug: chSlug, title: chSlug })
      .returning();
    for (const l of lessons) {
      const [row] = await db
        .insert(s.lesson)
        .values({ chapterId: ch!.id, slug: l, title: l, status: "published" })
        .returning();
      lessonIds.set(`${chSlug}/${l}`, row!.id);
    }
  }
});

describe("parseProgressFile", () => {
  it("validates every line strictly and names the line", () => {
    let problems = "";
    try {
      parseProgressFile(
        [
          file({ sub: "a", lessons: [] }),
          "",
          "{not json",
          file({ sub: "b", lessons: [], extra: 1 }),
          file({ lessons: [] }),
          file({ sub: "c", lessons: [done("l1", "yesterday")] }),
        ].join("\n"),
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ProgressFileError);
      problems = (e as InstanceType<typeof ProgressFileError>).problems.join("\n");
    }
    expect(problems).toMatch(/line 3: not valid JSON/);
    expect(problems).toMatch(/line 4: .*extra/);
    expect(problems).toMatch(/line 5: .*sub or email is required/);
    expect(problems).toMatch(/line 6: lessons\.0\.completed_at/);
    expect(problems).not.toMatch(/line 1:/);
    expect(() => parseProgressFile("\n\n")).toThrow(/no records/);
  });
});

describe("import-progress", () => {
  it("creates the sub placeholder, writes completions, and a re-run changes nothing", async () => {
    const text = file({
      sub: "new-sub",
      email: "New@Example.invalid",
      name: "New Learner",
      lessons: [
        done("l1", "2025-03-01T10:00:00Z"),
        done("l2", "2025-03-02T10:00:00Z"),
        done("l2", "2025-01-01T10:00:00Z"),
      ],
    });
    const first = await run(text);
    expect(first.people).toEqual({ matched: 0, created: 1 });
    expect(first.lessons).toEqual({ created: 2, completed: 0, unchanged: 0, skipped: 0 });

    const p = (await personBy({ sub: "new-sub" }))!;
    expect(p).toMatchObject({
      email: "new@example.invalid",
      name: "New Learner",
      externalIss: null,
      roles: ["student"],
      emailOptOut: false,
    });
    const rows = await progressOf(p.id);
    expect(rows.get("ch1/l1")).toMatchObject({
      status: "completed",
      completedAt: new Date("2025-03-01T10:00:00Z"),
    });
    // A lesson listed twice keeps the earlier completion.
    expect(rows.get("ch1/l2")!.completedAt).toEqual(new Date("2025-01-01T10:00:00Z"));
    expect(await db.select().from(s.enrollment).where(eq(s.enrollment.personId, p.id))).toEqual([]);
    const audited = (await imports()).filter((a) => a.entityId === p.id);
    expect(audited).toHaveLength(1);
    expect(audited[0]!.diff).toMatchObject({
      actor: "cli:import",
      after: { created: 2, person: { placeholderCreated: true } },
    });

    const again = await run(text);
    expect(again.people).toEqual({ matched: 1, created: 0 });
    expect(again.lessons).toEqual({ created: 0, completed: 0, unchanged: 2, skipped: 0 });
    expect((await imports()).filter((a) => a.entityId === p.id)).toHaveLength(1);
  });

  it("never downgrades or re-dates a completion and upgrades a started row", async () => {
    const [p] = await db
      .insert(s.person)
      .values({
        email: "signed-in@example.invalid",
        name: "Signed In",
        roles: ["student"],
        externalSub: "live-sub",
        externalIss: ISSUER,
      })
      .returning();
    await db.insert(s.lessonProgress).values([
      {
        personId: p!.id,
        lessonId: lessonIds.get("ch1/l1")!,
        status: "completed",
        completedAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        personId: p!.id,
        lessonId: lessonIds.get("ch1/l2")!,
        status: "started",
        lastBlockSort: 3,
        mediaPositionS: 42,
      },
    ]);
    const report = await run(
      file({
        sub: "live-sub",
        lessons: [
          done("l1", "2024-01-01T00:00:00Z"),
          done("l2", "2024-01-02T00:00:00Z"),
          done("l1", "2024-01-03T00:00:00Z", "ch2"),
        ],
      }),
    );
    expect(report.people).toEqual({ matched: 1, created: 0 });
    expect(report.lessons).toEqual({ created: 1, completed: 1, unchanged: 1, skipped: 0 });
    const rows = await progressOf(p!.id);
    expect(rows.get("ch1/l1")!.completedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
    expect(rows.get("ch1/l2")).toMatchObject({
      status: "completed",
      completedAt: new Date("2024-01-02T00:00:00Z"),
      lastBlockSort: 3,
      mediaPositionS: 42,
    });
    expect(rows.get("ch2/l1")!.status).toBe("completed");
  });

  it("skips unknown courses, chapters and lessons and lists them", async () => {
    const report = await run(
      [
        file({
          sub: "skip-sub",
          course: "old-lms-42",
          lessons: [
            done("l3", "2025-05-05T00:00:00Z"),
            done("gone", "2025-05-05T00:00:00Z"),
            done("l1", "2025-05-05T00:00:00Z", "nope"),
          ],
        }),
        file({
          sub: "skip-sub",
          course: "no-such-course",
          lessons: [done("l1", "2025-05-05T00:00:00Z")],
        }),
      ].join("\n"),
    );
    expect(report.lessons).toEqual({ created: 1, completed: 0, unchanged: 0, skipped: 3 });
    expect(report.skipped).toEqual([
      { line: 1, ref: "old-lms-42/ch1/gone", reason: "unknown chapter or lesson" },
      { line: 1, ref: "old-lms-42/nope/l1", reason: "unknown chapter or lesson" },
      { line: 2, ref: "no-such-course", reason: "unknown course" },
    ]);
    const p = (await personBy({ sub: "skip-sub" }))!;
    expect([...(await progressOf(p.id)).keys()]).toEqual(["ch1/l3"]);
  });

  it("creates nobody for a line with nothing to write", async () => {
    const report = await run(
      file({ sub: "nothing-sub", lessons: [done("gone", "2025-05-05T00:00:00Z")] }),
    );
    expect(report.people).toEqual({ matched: 0, created: 0 });
    expect(await personBy({ sub: "nothing-sub" })).toBeNull();
  });

  it("dry run reports and writes nothing", async () => {
    const auditsBefore = (await imports()).length;
    const report = await run(
      file({
        sub: "dry-sub",
        email: "dry@example.invalid",
        lessons: [done("l1", "2025-01-01T00:00:00Z")],
      }),
      { dryRun: true },
    );
    expect(report).toMatchObject({
      dryRun: true,
      people: { created: 1 },
      lessons: { created: 1 },
    });
    expect(await personBy({ sub: "dry-sub" })).toBeNull();
    expect(await personBy({ email: "dry@example.invalid" })).toBeNull();
    expect((await imports()).length).toBe(auditsBefore);
  });

  it("matches by email, adopting the sub, and skips an email held by another sub", async () => {
    const [manual] = await db
      .insert(s.person)
      .values({ email: "manual@example.invalid", name: "M", roles: ["student"] })
      .returning();
    const report = await run(
      [
        file({
          sub: "manual-sub",
          email: "manual@example.invalid",
          lessons: [done("l1", "2025-01-01T00:00:00Z")],
        }),
        file({
          sub: "other-sub",
          email: "signed-in@example.invalid",
          lessons: [done("l1", "2025-01-01T00:00:00Z")],
        }),
      ].join("\n"),
    );
    expect(report.people).toEqual({ matched: 1, created: 0 });
    expect(report.skipped).toEqual([
      { line: 2, ref: "prog", reason: "the email belongs to a person with another sub" },
    ]);
    expect((await personBy({ email: "manual@example.invalid" }))!).toMatchObject({
      id: manual!.id,
      externalSub: "manual-sub",
    });
  });

  it("a sub without an email gets the service API's made-up address", async () => {
    await run(file({ sub: "bare-sub", lessons: [done("l1", "2025-01-01T00:00:00Z")] }));
    expect((await personBy({ sub: "bare-sub" }))!).toMatchObject({
      email: placeholderEmail("bare-sub"),
      emailOptOut: true,
    });
  });

  it("in local mode an unknown learner is skipped, not created", async () => {
    const report = await run(
      file({
        sub: "local-sub",
        email: "local@example.invalid",
        lessons: [done("l1", "2025-01-01T00:00:00Z")],
      }),
      { authMode: "local", issuer: "" },
    );
    expect(report.people).toEqual({ matched: 0, created: 0 });
    expect(report.skipped[0]!.reason).toMatch(/AUTH_MODE is local/);
    expect(await personBy({ email: "local@example.invalid" })).toBeNull();
  });
});

describe("adoption at the first sign-in", () => {
  it("moves the placeholder's progress, keeping the completed and the earliest row", async () => {
    await run(
      file({
        sub: "adopt-sub",
        email: "old-address@example.invalid",
        lessons: [
          done("l1", "2024-01-01T00:00:00Z"),
          done("l2", "2024-02-01T00:00:00Z"),
          done("l3", "2024-03-01T00:00:00Z"),
        ],
      }),
    );
    const placeholder = (await personBy({ sub: "adopt-sub" }))!;
    // Signed in under another address: better-auth made a second person, who has played a bit.
    const [real] = await db
      .insert(s.person)
      .values({ email: "new-address@example.invalid", name: "Real", roles: ["student"] })
      .returning();
    await db.insert(s.lessonProgress).values([
      { personId: real!.id, lessonId: lessonIds.get("ch1/l1")!, status: "started" },
      {
        personId: real!.id,
        lessonId: lessonIds.get("ch1/l2")!,
        status: "completed",
        completedAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        personId: real!.id,
        lessonId: lessonIds.get("ch2/l1")!,
        status: "completed",
        completedAt: new Date("2023-01-01T00:00:00Z"),
      },
    ]);
    await db.insert(s.lessonProgress).values({
      personId: placeholder.id,
      lessonId: lessonIds.get("ch2/l1")!,
      status: "completed",
      completedAt: new Date("2024-06-01T00:00:00Z"),
    });

    expect(await adoptSubPlaceholder(real!.id, "adopt-sub")).toBe(true);
    expect(await db.select().from(s.person).where(eq(s.person.id, placeholder.id))).toEqual([]);
    const rows = await progressOf(real!.id);
    expect(rows.size).toBe(4);
    expect(rows.get("ch1/l1")).toMatchObject({
      status: "completed",
      completedAt: new Date("2024-01-01T00:00:00Z"),
    });
    expect(rows.get("ch1/l2")!.completedAt).toEqual(new Date("2024-02-01T00:00:00Z"));
    expect(rows.get("ch1/l3")!.completedAt).toEqual(new Date("2024-03-01T00:00:00Z"));
    expect(rows.get("ch2/l1")!.completedAt).toEqual(new Date("2023-01-01T00:00:00Z"));
    const [row] = await db
      .select()
      .from(s.auditLog)
      .where(
        and(eq(s.auditLog.action, "person.adopt_placeholder"), eq(s.auditLog.entityId, real!.id)),
      );
    expect((row!.diff as { after: unknown }).after).toMatchObject({
      progressMoved: 3,
      progressDropped: 1,
    });
  });
});
