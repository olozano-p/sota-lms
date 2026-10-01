/**
 * Writes a content bundle (`src/lib/content-bundle.ts`, ADR-021) into the database and the
 * storage provider. The one writer of content outside the authoring server functions: it follows
 * the same rules (one transaction, an `audit_log` row per course) with a different authority,
 * because it runs from `pnpm sota import` where the operator's shell and `DATABASE_URL` are the
 * credential, as for `create-admin`. Nothing here is reachable from a request.
 *
 * Idempotent by slug (a course also by `external_ref`; chapters and lessons by slug inside their
 * parent; cohorts by slug; assignments and quizzes by title and position among equal titles): a
 * row identical to the bundle is not written, a differing one is updated, a missing one is created,
 * and rows the bundle does not mention are left alone. Database ids never travel: they are
 * remapped (blocks to assignments, quizzes and files; Markdown images to `/api/files/<new id>`).
 * `dryRun` runs the whole import in the transaction and rolls it back, so its report is what a real
 * run would do, constraint errors included, and nothing is stored. Plain-Node safe.
 */
import { createHash } from "node:crypto";
import { and, asc, count, eq, like, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/index.ts";
import {
  assignment,
  chapter,
  cohort,
  cohortRelease,
  course,
  file,
  lesson,
  lessonBlock,
  question,
  questionOption,
  quiz,
  quizAttempt,
} from "../../db/schema.ts";
import {
  BundleError,
  markdownFields,
  mediaTokensIn,
  replaceMediaTokens,
  type Bundle,
  type BundleBlock,
  type BundleCourse,
} from "../../lib/content-bundle.ts";
import { audit, capDetail } from "../audit.ts";

/** Who runs the import: minted only by `cliActor()`, recorded as `diff.actor`. */
export interface ContentActor {
  readonly label: string;
}
export const cliActor = (): ContentActor => ({ label: "cli:import" });

/** The part of the storage provider the import needs. */
export interface ImportStorage {
  headObject(key: string): Promise<{ size: number; mime: string } | null>;
  putObject(key: string, body: Uint8Array | string, mime: string): Promise<void>;
}

export interface ImportOptions {
  dryRun: boolean;
  /** Rows created by this import (courses, lessons) start as drafts; existing ones keep their status. */
  draft: boolean;
  /** The deployment's upload limits: a bundle is not a way around them. */
  maxBytes: number;
  allowedMime: string[];
}

export interface Tally {
  created: number;
  updated: number;
  unchanged: number;
}
const tally = (): Tally => ({ created: 0, updated: 0, unchanged: 0 });

export interface CourseReport {
  slug: string;
  op: "created" | "updated" | "unchanged";
  chapters: Tally;
  lessons: Tally;
  /** Lessons whose list of blocks was replaced because it differed. */
  blocksReplaced: number;
  assignments: Tally;
  quizzes: Tally;
  cohorts: Tally;
  releases: Tally;
  media: { uploaded: number; reused: number };
}

export interface ImportReport {
  dryRun: boolean;
  courses: CourseReport[];
  warnings: string[];
}

/** Thrown after a dry run to roll the transaction back; carries the report out. */
class DryRunRollback extends Error {
  report: ImportReport;
  constructor(report: ImportReport) {
    super("dry run");
    this.report = report;
  }
}

/** Key-order independent JSON, so a payload read back from jsonb compares equal to the bundle's. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const safeName = (filename: string) => {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "");
  return (cleaned || "file").slice(-100);
};

/** Checks every media file against its manifest entry and the upload policy before anything is written. */
export function verifyMedia(
  bundle: Bundle,
  files: Map<string, Uint8Array>,
  policy: Pick<ImportOptions, "maxBytes" | "allowedMime">,
): void {
  const problems: string[] = [];
  for (const m of bundle.media) {
    const body = files.get(m.path);
    if (!body) {
      problems.push(
        `media ${m.id}: ${m.path} is missing from the bundle or has a different size than the manifest says`,
      );
      continue;
    }
    if (body.byteLength !== m.size)
      problems.push(
        `media ${m.id}: ${m.path} is ${body.byteLength} bytes, the manifest says ${m.size}`,
      );
    else if (createHash("sha256").update(body).digest("hex") !== m.sha256)
      problems.push(`media ${m.id}: ${m.path} does not match its sha256`);
    if (m.size > policy.maxBytes)
      problems.push(`media ${m.id}: ${m.filename} is larger than the upload limit`);
    if (!policy.allowedMime.includes(m.mime))
      problems.push(`media ${m.id}: type ${m.mime} is not allowed here`);
  }
  if (problems.length) throw new BundleError(problems);
}

export async function importContent(
  db: Db,
  actor: ContentActor,
  bundle: Bundle,
  files: Map<string, Uint8Array>,
  storage: ImportStorage,
  opts: ImportOptions,
): Promise<ImportReport> {
  verifyMedia(bundle, files, opts);
  try {
    return await db.transaction(async (tx) => {
      const report: ImportReport = { dryRun: opts.dryRun, courses: [], warnings: [] };
      for (const c of bundle.courses)
        report.courses.push(await importCourse(tx, actor, bundle, files, storage, opts, c, report));
      if (opts.dryRun) throw new DryRunRollback(report);
      return report;
    });
  } catch (e) {
    if (e instanceof DryRunRollback) return e.report;
    throw e;
  }
}

type Change = { entity: string; ref: string; op: "created" | "updated" | "replaced" };

async function importCourse(
  tx: DbOrTx,
  actor: ContentActor,
  bundle: Bundle,
  files: Map<string, Uint8Array>,
  storage: ImportStorage,
  opts: ImportOptions,
  c: BundleCourse,
  report: ImportReport,
): Promise<CourseReport> {
  const out: CourseReport = {
    slug: c.slug,
    op: "unchanged",
    chapters: tally(),
    lessons: tally(),
    blocksReplaced: 0,
    assignments: tally(),
    quizzes: tally(),
    cohorts: tally(),
    releases: tally(),
    media: { uploaded: 0, reused: 0 },
  };
  const changes: Change[] = [];
  const note = (entity: string, ref: string, op: Change["op"]) => changes.push({ entity, ref, op });
  const warn = (message: string) => report.warnings.push(`course ${c.slug}: ${message}`);

  // ----- The course row -----
  const [bySlug] = await tx.select().from(course).where(eq(course.slug, c.slug)).limit(1);
  const [byRef] = c.external_ref
    ? await tx.select().from(course).where(eq(course.externalRef, c.external_ref)).limit(1)
    : [];
  if (bySlug && byRef && bySlug.id !== byRef.id)
    throw new BundleError([
      `course ${c.slug}: the slug belongs to one course and external_ref "${c.external_ref}" to another`,
    ]);
  const existing = bySlug ?? byRef ?? null;
  if (existing && existing.slug !== c.slug)
    warn(`matched the existing course "${existing.slug}" by external_ref; its slug is kept`);

  const status = existing
    ? opts.draft
      ? existing.status
      : c.status
    : opts.draft
      ? ("draft" as const)
      : c.status;
  const courseValues = {
    title: c.title,
    subtitle: c.subtitle,
    language: c.language,
    status,
    endedAt: c.ended_at,
    sort: c.sort,
    forumEnabled: c.forum_enabled,
    externalRef: c.external_ref ?? existing?.externalRef ?? null,
  };
  let courseId: string;
  let current: typeof course.$inferSelect;
  if (existing) {
    courseId = existing.id;
    current = existing;
  } else {
    const [row] = await tx
      .insert(course)
      .values({ slug: c.slug, ...courseValues, descriptionMd: "" })
      .returning();
    courseId = row!.id;
    current = row!;
    out.op = "created";
    note("course", c.slug, "created");
  }

  // ----- Media -----
  const fileIds = new Map<string, string>();
  const keys = new Map<string, string>();
  const mediaById = new Map(bundle.media.map((m) => [m.id, m]));
  /** Stores one media file under this course (once per content hash) and returns its key and file id. */
  async function place(mediaId: string, inline: boolean): Promise<{ key: string; fileId: string }> {
    const slot = `${mediaId}|${inline}`;
    const m = mediaById.get(mediaId)!;
    const prefix = `courses/${courseId}/${inline ? "inline/" : ""}`;
    if (!keys.has(slot)) {
      // The same bytes already in this course (an export imported back into its source) are reused.
      const candidates = await tx
        .select()
        .from(file)
        .where(and(eq(file.sha256, m.sha256), like(file.key, `${prefix}%`)))
        .orderBy(asc(file.createdAt), asc(file.id));
      const known = candidates.find((r) => inline || !r.key.startsWith(`${prefix}inline/`));
      const key = known?.key ?? `${prefix}${m.sha256.slice(0, 16)}-${safeName(m.filename)}`;
      let row =
        known ?? (await tx.select().from(file).where(eq(file.key, key)).limit(1))[0] ?? null;
      if (!row) {
        [row] = await tx
          .insert(file)
          .values({
            key,
            filename: m.filename,
            mime: m.mime,
            size: m.size,
            sha256: m.sha256,
            uploadedBy: null,
          })
          .returning();
        note("file", m.filename, "created");
      }
      const head = await storage.headObject(key);
      if (!head || head.size !== m.size) {
        if (!opts.dryRun) await storage.putObject(key, files.get(m.path)!, m.mime);
        out.media.uploaded++;
      } else out.media.reused++;
      keys.set(slot, key);
      fileIds.set(slot, row!.id);
    }
    return { key: keys.get(slot)!, fileId: fileIds.get(slot)! };
  }

  // Inline images first: the Markdown below needs their file ids.
  const inlineIds = new Set(markdownFields(c).flatMap((f) => mediaTokensIn(f.text)));
  for (const id of [...inlineIds].sort()) await place(id, true);
  const md = (text: string) =>
    replaceMediaTokens(text, (id) => {
      const fid = fileIds.get(`${id}|true`);
      return fid ? `/api/files/${fid}` : null;
    });

  let coverKey: string | null = null;
  if (c.cover_image) coverKey = (await place(c.cover_image, false)).key;

  // ----- Course fields, now that Markdown and cover are known -----
  const wantCourse = {
    ...courseValues,
    descriptionMd: md(c.description_md),
    coverImageKey: coverKey,
  };
  if (existing) {
    const have = {
      title: current.title,
      subtitle: current.subtitle,
      language: current.language,
      status: current.status,
      endedAt: current.endedAt,
      sort: current.sort,
      forumEnabled: current.forumEnabled,
      externalRef: current.externalRef,
      descriptionMd: current.descriptionMd,
      coverImageKey: current.coverImageKey,
    };
    if (!same(have, wantCourse)) {
      await tx.update(course).set(wantCourse).where(eq(course.id, courseId));
      out.op = "updated";
      note("course", c.slug, "updated");
    }
  } else {
    await tx.update(course).set(wantCourse).where(eq(course.id, courseId));
  }

  // ----- Assignments -----
  const existingAssignments = await tx
    .select()
    .from(assignment)
    .where(eq(assignment.courseId, courseId))
    .orderBy(asc(assignment.createdAt), asc(assignment.id));
  const assignmentId = new Map<string, string>();
  const claimed = new Set<string>();
  for (const a of c.assignments) {
    const want = {
      title: a.title,
      instructionsMd: md(a.instructions_md),
      submissionType: a.submission_type,
      allowResubmit: a.allow_resubmit,
    };
    const row = existingAssignments.find((x) => x.title === a.title && !claimed.has(x.id));
    if (row) {
      claimed.add(row.id);
      assignmentId.set(a.key, row.id);
      const have = {
        title: row.title,
        instructionsMd: row.instructionsMd,
        submissionType: row.submissionType,
        allowResubmit: row.allowResubmit,
      };
      if (same(have, want)) out.assignments.unchanged++;
      else {
        await tx.update(assignment).set(want).where(eq(assignment.id, row.id));
        out.assignments.updated++;
        note("assignment", a.title, "updated");
      }
    } else {
      const [created] = await tx
        .insert(assignment)
        .values({ courseId, ...want })
        .returning();
      assignmentId.set(a.key, created!.id);
      out.assignments.created++;
      note("assignment", a.title, "created");
    }
  }

  // ----- Quizzes -----
  const existingQuizzes = await tx
    .select()
    .from(quiz)
    .where(eq(quiz.courseId, courseId))
    .orderBy(asc(quiz.createdAt), asc(quiz.id));
  const quizId = new Map<string, string>();
  const claimedQuizzes = new Set<string>();
  for (const q of c.quizzes) {
    const wantFields = {
      title: q.title,
      introMd: md(q.intro_md),
      kind: q.kind,
      showAnswersAfterSubmit: q.show_answers_after_submit,
      passThreshold: q.pass_threshold,
    };
    const wantQuestions = q.questions.map((x) => ({
      type: x.type,
      promptMd: md(x.prompt_md),
      required: x.required,
      options: x.options.map((o) => ({ label: o.label, isCorrect: o.is_correct })),
    }));
    const insertQuestions = async (id: string) => {
      for (const [i, x] of wantQuestions.entries()) {
        const [qr] = await tx
          .insert(question)
          .values({
            quizId: id,
            sort: i + 1,
            type: x.type,
            promptMd: x.promptMd,
            required: x.required,
          })
          .returning();
        if (x.options.length)
          await tx.insert(questionOption).values(
            x.options.map((o, j) => ({
              questionId: qr!.id,
              sort: j + 1,
              label: o.label,
              isCorrect: o.isCorrect,
            })),
          );
      }
    };
    const row = existingQuizzes.find((x) => x.title === q.title && !claimedQuizzes.has(x.id));
    if (!row) {
      const [created] = await tx
        .insert(quiz)
        .values({ courseId, ...wantFields })
        .returning();
      await insertQuestions(created!.id);
      quizId.set(q.key, created!.id);
      out.quizzes.created++;
      note("quiz", q.title, "created");
      continue;
    }
    claimedQuizzes.add(row.id);
    quizId.set(q.key, row.id);
    const haveFields = {
      title: row.title,
      introMd: row.introMd,
      kind: row.kind,
      showAnswersAfterSubmit: row.showAnswersAfterSubmit,
      passThreshold: row.passThreshold,
    };
    const qs = await tx
      .select()
      .from(question)
      .where(eq(question.quizId, row.id))
      .orderBy(asc(question.sort), asc(question.createdAt), asc(question.id));
    const opts2 = qs.length
      ? await tx
          .select()
          .from(questionOption)
          .orderBy(asc(questionOption.sort), asc(questionOption.id))
          .where(
            sql`${questionOption.questionId} in (${sql.join(
              qs.map((x) => sql`${x.id}`),
              sql`, `,
            )})`,
          )
      : [];
    const haveQuestions = qs.map((x) => ({
      type: x.type,
      promptMd: x.promptMd,
      required: x.required,
      options: opts2
        .filter((o) => o.questionId === x.id)
        .map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
    }));
    let touched = false;
    if (!same(haveFields, wantFields)) {
      await tx.update(quiz).set(wantFields).where(eq(quiz.id, row.id));
      touched = true;
    }
    if (!same(haveQuestions, wantQuestions)) {
      const [attempts] = await tx
        .select({ n: count() })
        .from(quizAttempt)
        .where(eq(quizAttempt.quizId, row.id));
      if (attempts!.n > 0) {
        // Replacing the questions would delete the learners' answers with them.
        warn(`quiz "${q.title}" has attempts: its questions were not changed`);
      } else {
        await tx.delete(question).where(eq(question.quizId, row.id));
        await insertQuestions(row.id);
        touched = true;
      }
    }
    if (touched) {
      out.quizzes.updated++;
      note("quiz", q.title, "updated");
    } else out.quizzes.unchanged++;
  }

  // ----- Chapters, lessons, blocks -----
  const existingChapters = await tx.select().from(chapter).where(eq(chapter.courseId, courseId));
  const chapterId = new Map<string, string>();
  const lessonId = new Map<string, string>();
  const blockPayload = async (b: BundleBlock): Promise<Record<string, unknown>> => {
    switch (b.type) {
      case "text":
        return { md: md(b.md) };
      case "video":
        return {
          provider: b.provider,
          external_id: b.external_id,
          title: b.title,
          duration_s: b.duration_s,
          ...(b.thumbnail_url !== undefined ? { thumbnail_url: b.thumbnail_url } : {}),
        };
      case "audio":
        return {
          file_key: b.media ? (await place(b.media, false)).key : "",
          title: b.title,
          duration_s: b.duration_s,
        };
      case "file":
        return {
          file_key: b.media ? (await place(b.media, false)).key : "",
          title: b.title,
          mime: b.mime,
          size: b.size,
        };
      case "assignment":
        return { assignment_id: assignmentId.get(b.assignment)! };
      case "quiz":
        return { quiz_id: quizId.get(b.quiz)! };
      case "embed":
        return { url: b.url, title: b.title ?? null };
    }
  };

  for (const [ci, ch] of c.chapters.entries()) {
    const wantChapter = { title: ch.title, descriptionMd: md(ch.description_md), sort: ci + 1 };
    const row = existingChapters.find((x) => x.slug === ch.slug);
    let chId: string;
    if (!row) {
      const [created] = await tx
        .insert(chapter)
        .values({ courseId, slug: ch.slug, ...wantChapter })
        .returning();
      chId = created!.id;
      out.chapters.created++;
      note("chapter", ch.slug, "created");
    } else {
      chId = row.id;
      const have = { title: row.title, descriptionMd: row.descriptionMd, sort: row.sort };
      if (same(have, wantChapter)) out.chapters.unchanged++;
      else {
        await tx.update(chapter).set(wantChapter).where(eq(chapter.id, chId));
        out.chapters.updated++;
        note("chapter", ch.slug, "updated");
      }
    }
    chapterId.set(ch.slug, chId);

    const existingLessons = row
      ? await tx.select().from(lesson).where(eq(lesson.chapterId, chId))
      : [];
    for (const [li, l] of ch.lessons.entries()) {
      const lrow = existingLessons.find((x) => x.slug === l.slug);
      const wantLesson = {
        title: l.title,
        summary: l.summary,
        sort: li + 1,
        status: lrow
          ? opts.draft
            ? lrow.status
            : l.status
          : opts.draft
            ? ("draft" as const)
            : l.status,
        estimatedMinutes: l.estimated_minutes,
      };
      let lId: string;
      if (!lrow) {
        const [created] = await tx
          .insert(lesson)
          .values({ chapterId: chId, slug: l.slug, ...wantLesson })
          .returning();
        lId = created!.id;
        out.lessons.created++;
        note("lesson", `${ch.slug}/${l.slug}`, "created");
      } else {
        lId = lrow.id;
        const have = {
          title: lrow.title,
          summary: lrow.summary,
          sort: lrow.sort,
          status: lrow.status,
          estimatedMinutes: lrow.estimatedMinutes,
        };
        if (same(have, wantLesson)) out.lessons.unchanged++;
        else {
          await tx.update(lesson).set(wantLesson).where(eq(lesson.id, lId));
          out.lessons.updated++;
          note("lesson", `${ch.slug}/${l.slug}`, "updated");
        }
      }
      lessonId.set(`${ch.slug}/${l.slug}`, lId);

      const want = await Promise.all(
        l.blocks.map(async (b) => ({ type: b.type, payload: await blockPayload(b) })),
      );
      const have = lrow
        ? (
            await tx
              .select()
              .from(lessonBlock)
              .where(eq(lessonBlock.lessonId, lId))
              .orderBy(asc(lessonBlock.sort), asc(lessonBlock.createdAt), asc(lessonBlock.id))
          ).map((b) => ({ type: b.type, payload: b.payload }))
        : [];
      if (!same(have, want)) {
        await tx.delete(lessonBlock).where(eq(lessonBlock.lessonId, lId));
        if (want.length)
          await tx.insert(lessonBlock).values(
            want.map((b, i) => ({
              lessonId: lId,
              sort: i + 1,
              type: b.type,
              payload: b.payload as never,
            })),
          );
        if (lrow) out.blocksReplaced++;
        note("blocks", `${ch.slug}/${l.slug}`, "replaced");
      }
    }
  }

  // ----- Cohorts (only when the bundle carries them) -----
  for (const g of c.cohorts ?? []) {
    const [row] = await tx.select().from(cohort).where(eq(cohort.slug, g.slug)).limit(1);
    if (row && row.courseId !== courseId)
      throw new BundleError([`cohort ${g.slug}: the slug belongs to a cohort of another course`]);
    if (g.external_ref) {
      const [other] = await tx
        .select({ id: cohort.id })
        .from(cohort)
        .where(eq(cohort.externalRef, g.external_ref))
        .limit(1);
      if (other && other.id !== row?.id)
        throw new BundleError([
          `cohort ${g.slug}: external_ref "${g.external_ref}" belongs to another cohort`,
        ]);
    }
    const wantCohort = {
      title: g.title,
      externalRef: g.external_ref ?? row?.externalRef ?? null,
      startsAt: g.starts_at,
      endsAt: g.ends_at,
      status: g.status,
    };
    let gId: string;
    if (!row) {
      const [created] = await tx
        .insert(cohort)
        .values({ courseId, slug: g.slug, ...wantCohort })
        .returning();
      gId = created!.id;
      out.cohorts.created++;
      note("cohort", g.slug, "created");
    } else {
      gId = row.id;
      const have = {
        title: row.title,
        externalRef: row.externalRef,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        status: row.status,
      };
      if (same(have, wantCohort)) out.cohorts.unchanged++;
      else {
        await tx.update(cohort).set(wantCohort).where(eq(cohort.id, gId));
        out.cohorts.updated++;
        note("cohort", g.slug, "updated");
      }
    }
    const existingReleases = row
      ? await tx.select().from(cohortRelease).where(eq(cohortRelease.cohortId, gId))
      : [];
    for (const r of g.releases) {
      const target = r.chapter
        ? { chapterId: chapterId.get(r.chapter)!, lessonId: null }
        : { chapterId: null, lessonId: lessonId.get(r.lesson!)! };
      const at = new Date(r.release_at);
      const found = existingReleases.find(
        (x) => x.chapterId === target.chapterId && x.lessonId === target.lessonId,
      );
      if (found && found.releaseAt.getTime() === at.getTime()) out.releases.unchanged++;
      else {
        if (found) await tx.delete(cohortRelease).where(eq(cohortRelease.id, found.id));
        await tx.insert(cohortRelease).values({ cohortId: gId, ...target, releaseAt: at });
        if (found) out.releases.updated++;
        else out.releases.created++;
        note("cohort_release", `${g.slug}:${r.chapter ?? r.lesson}`, found ? "updated" : "created");
      }
    }
  }

  // ----- Audit: one row per course that changed, with the first changes listed -----
  if (changes.length) {
    const { rows, total, truncated } = capDetail(changes);
    await audit(tx, {
      actorId: null,
      actor: actor.label,
      action: "content.import",
      entity: "course",
      entityId: courseId,
      after: {
        slug: c.slug,
        op: out.op,
        chapters: out.chapters,
        lessons: out.lessons,
        blocksReplaced: out.blocksReplaced,
        assignments: out.assignments,
        quizzes: out.quizzes,
        cohorts: out.cohorts,
        releases: out.releases,
        media: out.media,
        total,
        truncated,
        changes: rows,
      },
    });
    if (out.op === "unchanged") out.op = "updated";
  }
  return out;
}
