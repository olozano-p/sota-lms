/**
 * `sota export` / `sota import`: a rich course is exported from one in-memory database, written
 * to a directory, read back and imported into a second database with its own storage; the second
 * export must equal the first. Also: idempotency, dry run, atomicity, validation before writing,
 * and that nothing personal travels.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/index.ts";

const { db: dbA, schema: s } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const { createLocalStorage } = await import("../src/server/services/storage/local.ts");
const { exportContent } = await import("../src/server/queries/content-export-core.ts");
const { importContent, cliActor } = await import("../src/server/mutations/content-import-core.ts");
const { readBundleDir, writeBundleDir } =
  await import("../src/server/services/content-bundle-dir.ts");
const { BUNDLE_FILE, BundleError, parseBundle } = await import("../src/lib/content-bundle.ts");

const POLICY = { maxBytes: 5_000_000, allowedMime: ["image/png", "application/pdf", "audio/mpeg"] };
const png = (n: number) => new Uint8Array([137, 80, 78, 71, n, n + 1, n + 2]);

let tmp: string;
let storageA: ReturnType<typeof createLocalStorage>;
let dbB: Db;
let storageB: ReturnType<typeof createLocalStorage>;
const ids: string[] = [];

async function freshDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" }) as unknown as Db;
  await runMigrations(db);
  return db;
}

const storageApi = (st: ReturnType<typeof createLocalStorage>) => ({
  headObject: st.headObject,
  putObject: st.putObject,
  getObject: st.getObject,
});

async function putFile(
  key: string,
  filename: string,
  mime: string,
  body: Uint8Array,
  courseId: string,
) {
  await storageA.putObject(key, body, mime);
  const [row] = await dbA
    .insert(s.file)
    .values({
      key,
      filename,
      mime,
      size: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    })
    .returning();
  ids.push(row!.id);
  void courseId;
  return row!;
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sota-content-"));
  storageA = createLocalStorage({ root: join(tmp, "a"), secret: "x" });
  storageB = createLocalStorage({ root: join(tmp, "b"), secret: "x" });
  await runMigrations(dbA);
  dbB = await freshDb();

  const [c] = await dbA
    .insert(s.course)
    .values({
      slug: "rich",
      externalRef: "crs-1",
      title: "Rich course",
      subtitle: "Sub",
      descriptionMd: "Intro",
      language: "ca",
      status: "published",
      endedAt: "2026-12-01",
      sort: 3,
      forumEnabled: true,
    })
    .returning();
  ids.push(c!.id);
  const cid = c!.id;
  const cover = await putFile(`courses/${cid}/cover.png`, "cover.png", "image/png", png(1), cid);
  const inline = await putFile(
    `courses/${cid}/inline/pic.png`,
    "pic.png",
    "image/png",
    png(10),
    cid,
  );
  const pdf = await putFile(
    `courses/${cid}/doc.pdf`,
    "Reading list.pdf",
    "application/pdf",
    new Uint8Array([37, 80, 68, 70, 1]),
    cid,
  );
  const mp3 = await putFile(
    `courses/${cid}/talk.mp3`,
    "talk.mp3",
    "audio/mpeg",
    new Uint8Array([1, 2, 3, 4]),
    cid,
  );
  await dbA
    .update(s.course)
    .set({
      coverImageKey: cover.key,
      descriptionMd: `Intro with ![pic](/api/files/${inline.id}?inline=1)`,
    })
    .where(eq(s.course.id, cid));

  const [asg] = await dbA
    .insert(s.assignment)
    .values({ courseId: cid, title: "Essay", instructionsMd: "Write.", submissionType: "text" })
    .returning();
  const [quizRow] = await dbA
    .insert(s.quiz)
    .values({
      courseId: cid,
      title: "Check",
      introMd: "Try",
      kind: "self_check",
      passThreshold: 60,
    })
    .returning();
  const [q1] = await dbA
    .insert(s.question)
    .values({ quizId: quizRow!.id, sort: 1, type: "single_choice", promptMd: "Pick" })
    .returning();
  await dbA.insert(s.questionOption).values([
    { questionId: q1!.id, sort: 1, label: "Yes", isCorrect: true },
    { questionId: q1!.id, sort: 2, label: "No", isCorrect: false },
  ]);
  await dbA
    .insert(s.question)
    .values({ quizId: quizRow!.id, sort: 2, type: "long_text", promptMd: "Why?", required: false });

  const [ch1] = await dbA
    .insert(s.chapter)
    .values({
      courseId: cid,
      slug: "start",
      title: "Start",
      sort: 1,
      descriptionMd: `Chapter ![x](/api/files/${inline.id})`,
    })
    .returning();
  const [ch2] = await dbA
    .insert(s.chapter)
    .values({ courseId: cid, slug: "more", title: "More", sort: 2 })
    .returning();
  const [l1] = await dbA
    .insert(s.lesson)
    .values({
      chapterId: ch1!.id,
      slug: "welcome",
      title: "Welcome",
      sort: 1,
      status: "published",
      estimatedMinutes: 5,
      summary: "Hi",
    })
    .returning();
  const [l2] = await dbA
    .insert(s.lesson)
    .values({ chapterId: ch1!.id, slug: "draft-one", title: "Draft", sort: 2, status: "draft" })
    .returning();
  const [l3] = await dbA
    .insert(s.lesson)
    .values({ chapterId: ch2!.id, slug: "deep", title: "Deep", sort: 1, status: "published" })
    .returning();
  await dbA.insert(s.lessonBlock).values([
    {
      lessonId: l1!.id,
      sort: 1,
      type: "text",
      payload: { md: `Look ![pic](/api/files/${inline.id}?inline=1)` },
    },
    {
      lessonId: l1!.id,
      sort: 2,
      type: "video",
      payload: {
        provider: "vimeo",
        external_id: "123",
        title: "V",
        duration_s: 60,
        thumbnail_url: null,
      },
    },
    {
      lessonId: l1!.id,
      sort: 3,
      type: "audio",
      payload: { file_key: mp3.key, title: "Talk", duration_s: 4 },
    },
    {
      lessonId: l1!.id,
      sort: 4,
      type: "file",
      payload: { file_key: pdf.key, title: "Reading", mime: "application/pdf", size: 5 },
    },
    {
      lessonId: l1!.id,
      sort: 5,
      type: "embed",
      payload: { url: "https://example.org/x", title: null },
    },
    { lessonId: l3!.id, sort: 1, type: "assignment", payload: { assignment_id: asg!.id } },
    { lessonId: l3!.id, sort: 2, type: "quiz", payload: { quiz_id: quizRow!.id } },
  ]);
  ids.push(ch1!.id, ch2!.id, l1!.id, l2!.id, l3!.id, asg!.id, quizRow!.id, q1!.id, cover.id);

  const [g] = await dbA
    .insert(s.cohort)
    .values({
      courseId: cid,
      slug: "autumn",
      externalRef: "coh-1",
      title: "Autumn",
      startsAt: "2026-09-01",
      status: "active",
    })
    .returning();
  await dbA.insert(s.cohortRelease).values([
    { cohortId: g!.id, chapterId: ch2!.id, releaseAt: new Date("2026-10-01T07:00:00Z") },
    { cohortId: g!.id, lessonId: l2!.id, releaseAt: new Date("2026-11-01T07:00:00Z") },
  ]);

  // Everything personal that must never travel.
  const [p] = await dbA
    .insert(s.person)
    .values({ email: "learner-secret@example.invalid", name: "Learner Secret", roles: ["student"] })
    .returning();
  await dbA.insert(s.enrollment).values({ personId: p!.id, courseId: cid, source: "manual" });
  await dbA.insert(s.cohortMember).values({ cohortId: g!.id, personId: p!.id });
  await dbA
    .insert(s.submission)
    .values({ assignmentId: asg!.id, personId: p!.id, textMd: "my private essay" });
  await dbA
    .insert(s.lessonProgress)
    .values({ personId: p!.id, lessonId: l1!.id, completedAt: new Date() });
  await dbA.insert(s.quizAttempt).values({ quizId: quizRow!.id, personId: p!.id });
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

const exportA = (cohorts = true) =>
  exportContent(dbA, storageA, {
    courses: ["rich"],
    cohorts,
    version: "9.9.9",
    now: new Date("2026-10-01T00:00:00Z"),
  });
const runImport = (
  db: Db,
  bundle: Awaited<ReturnType<typeof readBundleDir>>,
  st = storageB,
  o: { dryRun?: boolean; draft?: boolean } = {},
) =>
  importContent(db, cliActor(), bundle.bundle, bundle.files, storageApi(st), {
    dryRun: o.dryRun ?? false,
    draft: o.draft ?? false,
    ...POLICY,
  });

async function through(dir: string, result: Awaited<ReturnType<typeof exportA>>) {
  await writeBundleDir(dir, result.bundle, result.files, { force: true });
  return readBundleDir(dir);
}

const counts = async (db: Db) => ({
  course: (await db.select().from(s.course)).length,
  chapter: (await db.select().from(s.chapter)).length,
  lesson: (await db.select().from(s.lesson)).length,
  block: (await db.select().from(s.lessonBlock)).length,
  assignment: (await db.select().from(s.assignment)).length,
  quiz: (await db.select().from(s.quiz)).length,
  question: (await db.select().from(s.question)).length,
  option: (await db.select().from(s.questionOption)).length,
  file: (await db.select().from(s.file)).length,
  cohort: (await db.select().from(s.cohort)).length,
  release: (await db.select().from(s.cohortRelease)).length,
  audit: (await db.select().from(s.auditLog)).length,
});

describe("round trip", () => {
  it("exports without anything personal and without a single database id", async () => {
    const result = await exportA();
    expect(result.warnings).toEqual([]);
    const json = JSON.stringify(result.bundle);
    for (const secret of ["learner-secret", "Learner Secret", "my private essay", ...ids])
      expect(json).not.toContain(secret);
    expect(Object.keys(result.bundle)).toEqual([
      "format",
      "version",
      "exported_at",
      "sota_version",
      "courses",
      "media",
    ]);
    expect(result.bundle.media.map((m) => m.filename).sort()).toEqual([
      "Reading list.pdf",
      "cover.png",
      "pic.png",
      "talk.mp3",
    ]);
    const [c] = result.bundle.courses;
    expect(c!.cohorts![0]!.releases).toEqual([
      { chapter: "more", release_at: "2026-10-01T07:00:00.000Z" },
      { lesson: "start/draft-one", release_at: "2026-11-01T07:00:00.000Z" },
    ]);
    expect(c!.description_md).toMatch(/sota-media:m\d+\?inline=1/);
  });

  it("imports into another database and the second export equals the first", async () => {
    const first = await exportA();
    const bundle = await through(join(tmp, "dir1"), first);
    const report = await runImport(dbB, bundle);
    expect(report.courses[0]).toMatchObject({
      op: "created",
      chapters: { created: 2 },
      lessons: { created: 3 },
      assignments: { created: 1 },
      quizzes: { created: 1 },
      cohorts: { created: 1 },
      releases: { created: 2 },
      media: { uploaded: 4 },
    });
    expect(report.warnings).toEqual([]);

    // The second database holds no person, enrollment, submission or progress.
    for (const t of [
      s.person,
      s.enrollment,
      s.cohortMember,
      s.submission,
      s.lessonProgress,
      s.quizAttempt,
    ])
      expect(await dbB.select().from(t)).toHaveLength(0);

    const second = await exportContent(dbB, storageB, {
      courses: ["rich"],
      cohorts: true,
      version: "9.9.9",
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(second.warnings).toEqual([]);
    expect(second.bundle).toEqual(first.bundle);
    for (const [path, body] of first.files) expect([...second.files.get(path)!]).toEqual([...body]);

    // Ids were remapped: the block points at the new assignment, the image at the new file row.
    const [asg] = await dbB.select().from(s.assignment);
    const blocks = await dbB.select().from(s.lessonBlock);
    expect(
      blocks.some((b) => (b.payload as { assignment_id?: string }).assignment_id === asg!.id),
    ).toBe(true);
    const [course] = await dbB.select().from(s.course);
    const fileRow = (await dbB.select().from(s.file)).find((f) => f.filename === "pic.png")!;
    expect(course!.descriptionMd).toContain(`/api/files/${fileRow.id}?inline=1`);
    expect(fileRow.key.startsWith(`courses/${course!.id}/inline/`)).toBe(true);
    expect(await storageB.headObject(fileRow.key)).toMatchObject({ size: 7, mime: "image/png" });

    // One audit row for the course, by the CLI actor.
    const audits = (await dbB.select().from(s.auditLog)).filter(
      (a) => a.action === "content.import",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorPersonId: null,
      entity: "course",
      entityId: course!.id,
    });
    expect((audits[0]!.diff as { actor: string }).actor).toBe("cli:import");
  });

  it("is idempotent: a second import changes nothing and writes no audit row", async () => {
    const bundle = await through(join(tmp, "dir2"), await exportA());
    const before = await counts(dbB);
    const report = await runImport(dbB, bundle);
    expect(report.courses[0]).toMatchObject({
      op: "unchanged",
      chapters: { created: 0, updated: 0, unchanged: 2 },
      lessons: { created: 0, updated: 0, unchanged: 3 },
      blocksReplaced: 0,
      assignments: { unchanged: 1 },
      quizzes: { unchanged: 1 },
      cohorts: { unchanged: 1 },
      releases: { unchanged: 2 },
      media: { uploaded: 0, reused: 4 },
    });
    expect(await counts(dbB)).toEqual(before);
  });

  it("imports an export back into its own database without duplicating anything", async () => {
    const bundle = await through(join(tmp, "dir3"), await exportA());
    const before = await counts(dbA);
    const report = await runImport(dbA, bundle, storageA);
    expect(report.courses[0]!.op).toBe("unchanged");
    expect(report.courses[0]!.media).toEqual({ uploaded: 0, reused: 4 });
    expect(await counts(dbA)).toEqual(before);
  });
});

describe("dry run", () => {
  it("reports what would happen and stores nothing, in the database or in storage", async () => {
    const empty = await freshDb();
    const store = createLocalStorage({ root: join(tmp, "dry"), secret: "x" });
    const bundle = await through(join(tmp, "dir4"), await exportA());
    const report = await runImport(empty, bundle, store, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.courses[0]).toMatchObject({
      op: "created",
      lessons: { created: 3 },
      media: { uploaded: 4 },
    });
    const c = await counts(empty);
    expect(Object.values(c).every((n) => n === 0)).toBe(true);
    const [meta] = bundle.bundle.media;
    expect(await store.headObject(`courses/x/${meta!.sha256}`)).toBeNull();
    // A real run afterwards behaves as the report said.
    const real = await runImport(empty, bundle, store);
    expect(real.courses[0]).toMatchObject({ op: "created", lessons: { created: 3 } });
  });
});

describe("updates", () => {
  it("updates changed rows, replaces differing block lists and audits the change", async () => {
    const db = await freshDb();
    const st = createLocalStorage({ root: join(tmp, "upd"), secret: "x" });
    const bundle = await through(join(tmp, "dir5"), await exportA());
    await runImport(db, bundle, st);

    const edited = structuredClone(bundle);
    edited.bundle.courses[0]!.title = "Renamed";
    edited.bundle.courses[0]!.chapters[0]!.lessons[0]!.blocks.push({ type: "text", md: "Added" });
    const report = await runImport(db, edited, st);
    expect(report.courses[0]).toMatchObject({
      op: "updated",
      blocksReplaced: 1,
      lessons: { unchanged: 3 },
    });
    const [c] = await db.select().from(s.course);
    expect(c!.title).toBe("Renamed");
    const rows = (await db.select().from(s.auditLog)).filter((a) => a.action === "content.import");
    expect(rows).toHaveLength(2);
    const last = rows.at(-1)!.diff as { after: { changes: { entity: string; op: string }[] } };
    expect(last.after.changes).toEqual(
      expect.arrayContaining([
        { entity: "course", ref: "rich", op: "updated" },
        { entity: "blocks", ref: "start/welcome", op: "replaced" },
      ]),
    );
  });

  it("leaves the questions of a quiz that already has attempts alone and says so", async () => {
    const db = await freshDb();
    const st = createLocalStorage({ root: join(tmp, "att"), secret: "x" });
    const bundle = await through(join(tmp, "dir6"), await exportA());
    await runImport(db, bundle, st);
    const [q] = await db.select().from(s.quiz);
    const [p] = await db
      .insert(s.person)
      .values({ email: "a@example.invalid", name: "A" })
      .returning();
    await db.insert(s.quizAttempt).values({ quizId: q!.id, personId: p!.id });

    const edited = structuredClone(bundle);
    edited.bundle.courses[0]!.quizzes[0]!.questions.pop();
    const report = await runImport(db, edited, st);
    expect(report.warnings.join("\n")).toMatch(/has attempts/);
    expect(await db.select().from(s.question)).toHaveLength(2);
  });

  it("creates drafts with --draft and keeps the status of what exists", async () => {
    const db = await freshDb();
    const st = createLocalStorage({ root: join(tmp, "dr"), secret: "x" });
    const bundle = await through(join(tmp, "dir7"), await exportA());
    await runImport(db, bundle, st, { draft: true });
    expect((await db.select().from(s.course))[0]!.status).toBe("draft");
    expect((await db.select().from(s.lesson)).every((l) => l.status === "draft")).toBe(true);
    await db.update(s.course).set({ status: "published" });
    await runImport(db, bundle, st, { draft: true });
    expect((await db.select().from(s.course))[0]!.status).toBe("published");
  });

  it("matches a course by external_ref and keeps its slug", async () => {
    const db = await freshDb();
    const st = createLocalStorage({ root: join(tmp, "ref"), secret: "x" });
    const bundle = await through(join(tmp, "dir8"), await exportA());
    await runImport(db, bundle, st);
    await db.update(s.course).set({ slug: "renamed-here" });
    const report = await runImport(db, bundle, st);
    expect(report.warnings.join("\n")).toMatch(/matched the existing course "renamed-here"/);
    expect(await db.select().from(s.course)).toHaveLength(1);
  });
});

describe("atomicity and validation", () => {
  it("rolls everything back when a later step fails", async () => {
    const db = await freshDb();
    const st = createLocalStorage({ root: join(tmp, "atom"), secret: "x" });
    const [other] = await db
      .insert(s.course)
      .values({ slug: "other", title: "O", language: "en" })
      .returning();
    await db.insert(s.cohort).values({ courseId: other!.id, slug: "autumn", title: "Taken" });
    const bundle = await through(join(tmp, "dir9"), await exportA());
    await expect(runImport(db, bundle, st)).rejects.toThrow(/cohort autumn/);
    const c = await counts(db);
    expect(c).toMatchObject({
      course: 1,
      chapter: 0,
      lesson: 0,
      block: 0,
      assignment: 0,
      quiz: 0,
      audit: 0,
    });
  });

  it("rejects a bundle that points at nothing, before writing anything", async () => {
    const good = (await exportA()).bundle;
    const bad = structuredClone(good);
    bad.courses[0]!.chapters[0]!.lessons[0]!.blocks.push({ type: "assignment", assignment: "zz9" });
    bad.courses[0]!.description_md = "![x](sota-media:m99)";
    bad.courses[0]!.chapters.push({ ...bad.courses[0]!.chapters[0]! });
    try {
      parseBundle(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BundleError);
      const text = (e as Error).message;
      expect(text).toMatch(/unknown assignment "zz9"/);
      expect(text).toMatch(/unknown media "m99"/);
      expect(text).toMatch(/chapter slug "start" appears twice/);
    }
    const twice = structuredClone(good);
    const rel = twice.courses[0]!.cohorts![0]!.releases;
    rel.push({ ...rel[0]! });
    expect(() => parseBundle(twice)).toThrow(/release target "more" appears twice/);
    const reserved = structuredClone(good);
    reserved.courses[0]!.chapters[0]!.lessons[0]!.slug = "forum";
    expect(() => parseBundle(reserved)).toThrow(/reserved/);
    expect(() => parseBundle({ ...good, version: 2 })).toThrow(BundleError);
    expect(() => parseBundle({ ...good, extra: 1 })).toThrow(BundleError);
  });

  it("refuses media paths that leave the bundle and media that do not match their hash", async () => {
    const good = (await exportA()).bundle;
    const escape = structuredClone(good);
    escape.media[0]!.path = "media/../../etc/passwd";
    expect(() => parseBundle(escape)).toThrow(BundleError);

    const dir = join(tmp, "dir10");
    await writeBundleDir(dir, good, (await exportA()).files, { force: true });
    const first = good.media[0]!;
    await writeFile(join(dir, first.path), new Uint8Array(first.size).fill(7));
    const loaded = await readBundleDir(dir);
    await expect(runImport(await freshDb(), loaded)).rejects.toThrow(/does not match its sha256/);
  });

  it("applies the deployment's upload policy to imported media", async () => {
    const bundle = await through(join(tmp, "dir11"), await exportA());
    await expect(
      importContent(
        await freshDb(),
        cliActor(),
        bundle.bundle,
        bundle.files,
        storageApi(storageB),
        {
          dryRun: true,
          draft: false,
          maxBytes: 3,
          allowedMime: ["image/png"],
        },
      ),
    ).rejects.toThrow(/larger than the upload limit|not allowed here/);
  });

  it("does not follow a symlinked media file out of the directory", async () => {
    const dir = join(tmp, "dir12");
    const result = await exportA();
    await writeBundleDir(dir, result.bundle, result.files, { force: true });
    const outside = join(tmp, "outside.bin");
    const m = result.bundle.media[0]!;
    await writeFile(outside, result.files.get(m.path)!);
    await rm(join(dir, m.path));
    await symlink(outside, join(dir, m.path));
    const loaded = await readBundleDir(dir);
    expect(loaded.files.has(m.path)).toBe(false);
    await expect(runImport(await freshDb(), loaded)).rejects.toThrow(/missing from the bundle/);
  });

  it("refuses to overwrite an export without --force and to read a directory that is not one", async () => {
    const dir = join(tmp, "dir13");
    const result = await exportA();
    await writeBundleDir(dir, result.bundle, result.files, { force: false });
    await expect(
      writeBundleDir(dir, result.bundle, result.files, { force: false }),
    ).rejects.toThrow(/already exists/);
    const empty = join(tmp, "empty");
    await mkdir(empty);
    await expect(readBundleDir(empty)).rejects.toThrow(new RegExp(BUNDLE_FILE));
    expect(JSON.parse(await readFile(join(dir, BUNDLE_FILE), "utf8")).format).toBe("sota-content");
  });
});
