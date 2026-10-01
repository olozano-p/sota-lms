/**
 * Reads courses into a content bundle (`src/lib/content-bundle.ts`, ADR-021) and gathers the
 * media they reference through the `StorageProvider`. A read: it writes nothing, so it has no
 * audit row and no actor. Never reads people, enrollments, submissions or progress. Plain-Node
 * safe (relative imports with .ts extensions): `pnpm sota export` runs it.
 */
import { createHash } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/index.ts";
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
} from "../../db/schema.ts";
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MEDIA_DIR,
  fileUrlsIn,
  parseBundle,
  replaceFileUrls,
  type Bundle,
  type BundleBlock,
  type BundleCourse,
} from "../../lib/content-bundle.ts";

/** The part of the storage provider the export needs. */
export interface ExportStorage {
  getObject(key: string): Promise<{ body: Uint8Array; mime: string } | null>;
}

export interface ExportOptions {
  /** Slugs to export, or every course. */
  courses: string[] | "all";
  /** Include each course's cohorts with their drip releases (never their members). */
  cohorts: boolean;
  /** The running build, recorded in the bundle. */
  version: string;
  now?: Date;
}

export interface ExportResult {
  bundle: Bundle;
  /** Bytes of each media file, keyed by its bundle path (`media/m1-name.png`). */
  files: Map<string, Uint8Array>;
  warnings: string[];
}

const safeName = (filename: string) => {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "");
  return (cleaned || "file").slice(-100);
};

export async function exportContent(
  tx: DbOrTx,
  storage: ExportStorage,
  opts: ExportOptions,
): Promise<ExportResult> {
  const warnings: string[] = [];
  const wanted =
    opts.courses === "all"
      ? await tx.select().from(course).orderBy(asc(course.sort), asc(course.slug))
      : await tx.select().from(course).where(inArray(course.slug, opts.courses));
  if (opts.courses !== "all") {
    const missing = opts.courses.filter((s) => !wanted.some((c) => c.slug === s));
    if (missing.length) throw new Error(`no such course: ${missing.join(", ")}`);
    wanted.sort((a, b) => opts.courses.indexOf(a.slug) - opts.courses.indexOf(b.slug));
  }
  if (!wanted.length) throw new Error("nothing to export: there are no courses");

  const media: Bundle["media"] = [];
  const files = new Map<string, Uint8Array>();
  const refByKey = new Map<string, string | null>();

  /** Registers a stored object and returns its media id, or null (with a warning) when it is gone. */
  async function mediaFor(storageKey: string, where: string): Promise<string | null> {
    if (refByKey.has(storageKey)) return refByKey.get(storageKey)!;
    const [row] = await tx.select().from(file).where(eq(file.key, storageKey)).limit(1);
    const object = await storage.getObject(storageKey);
    if (!object) {
      warnings.push(`${where}: the file ${storageKey} is missing from storage and was left out`);
      refByKey.set(storageKey, null);
      return null;
    }
    const id = `m${media.length + 1}`;
    const filename = row?.filename ?? storageKey.split("/").pop()!;
    const path = `${MEDIA_DIR}/${id}-${safeName(filename)}`;
    media.push({
      id,
      path,
      filename,
      mime: row?.mime ?? object.mime,
      size: object.body.byteLength,
      sha256: createHash("sha256").update(object.body).digest("hex"),
    });
    files.set(path, object.body);
    refByKey.set(storageKey, id);
    return id;
  }

  const courses: BundleCourse[] = [];
  for (const c of wanted) {
    const chapters = await tx
      .select()
      .from(chapter)
      .where(eq(chapter.courseId, c.id))
      .orderBy(asc(chapter.sort), asc(chapter.slug));
    const lessons = chapters.length
      ? await tx
          .select()
          .from(lesson)
          .where(
            inArray(
              lesson.chapterId,
              chapters.map((x) => x.id),
            ),
          )
          .orderBy(asc(lesson.sort), asc(lesson.slug))
      : [];
    const blocks = lessons.length
      ? await tx
          .select()
          .from(lessonBlock)
          .where(
            inArray(
              lessonBlock.lessonId,
              lessons.map((x) => x.id),
            ),
          )
          .orderBy(asc(lessonBlock.sort), asc(lessonBlock.createdAt), asc(lessonBlock.id))
      : [];
    const assignments = await tx
      .select()
      .from(assignment)
      .where(eq(assignment.courseId, c.id))
      .orderBy(asc(assignment.createdAt), asc(assignment.id));
    const quizzes = await tx
      .select()
      .from(quiz)
      .where(eq(quiz.courseId, c.id))
      .orderBy(asc(quiz.createdAt), asc(quiz.id));
    const questions = quizzes.length
      ? await tx
          .select()
          .from(question)
          .where(
            inArray(
              question.quizId,
              quizzes.map((x) => x.id),
            ),
          )
          .orderBy(asc(question.sort), asc(question.createdAt), asc(question.id))
      : [];
    const options = questions.length
      ? await tx
          .select()
          .from(questionOption)
          .where(
            inArray(
              questionOption.questionId,
              questions.map((x) => x.id),
            ),
          )
          .orderBy(asc(questionOption.sort), asc(questionOption.id))
      : [];

    const assignmentKey = new Map(assignments.map((a, i) => [a.id, `a${i + 1}`]));
    const quizKey = new Map(quizzes.map((q, i) => [q.id, `q${i + 1}`]));

    // Inline images live in Markdown as `/api/files/<file id>`; resolve them to media ids up front
    // because the replacement itself is synchronous.
    const markdown = [
      c.descriptionMd,
      ...chapters.map((x) => x.descriptionMd),
      ...blocks.flatMap((b) => (b.type === "text" ? [(b.payload as { md: string }).md] : [])),
      ...assignments.map((a) => a.instructionsMd),
      ...quizzes.map((q) => q.introMd),
      ...questions.map((q) => q.promptMd),
    ];
    const ids = [...new Set(markdown.flatMap(fileUrlsIn))];
    const rows = ids.length ? await tx.select().from(file).where(inArray(file.id, ids)) : [];
    const mediaOfFileId = new Map<string, string | null>();
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        warnings.push(`course ${c.slug}: /api/files/${id} is not a known file and was left as is`);
        mediaOfFileId.set(id, null);
      } else mediaOfFileId.set(id, await mediaFor(row.key, `course ${c.slug}`));
    }
    const md = (text: string) =>
      replaceFileUrls(text, (id) => {
        const ref = mediaOfFileId.get(id);
        return ref ? `sota-media:${ref}` : null;
      });

    const cover = c.coverImageKey
      ? await mediaFor(c.coverImageKey, `course ${c.slug} cover`)
      : null;

    const blockOut = async (
      b: (typeof blocks)[number],
      where: string,
    ): Promise<BundleBlock | null> => {
      const p = b.payload as Record<string, unknown>;
      switch (b.type) {
        case "text":
          return { type: "text", md: md(p.md as string) };
        case "video":
          return {
            type: "video",
            provider: p.provider as string,
            external_id: p.external_id as string,
            title: (p.title as string) ?? "",
            duration_s: (p.duration_s as number | null) ?? null,
            ...(p.thumbnail_url !== undefined
              ? { thumbnail_url: p.thumbnail_url as string | null }
              : {}),
          };
        case "audio":
        case "file": {
          const k = typeof p.file_key === "string" && p.file_key ? p.file_key : null;
          const ref = k ? await mediaFor(k, where) : null;
          return b.type === "audio"
            ? {
                type: "audio",
                media: ref,
                title: (p.title as string) ?? "",
                duration_s: (p.duration_s as number | null) ?? null,
              }
            : {
                type: "file",
                media: ref,
                title: (p.title as string) ?? "",
                mime: (p.mime as string) ?? "",
                size: (p.size as number) ?? 0,
              };
        }
        case "assignment": {
          const k = assignmentKey.get(p.assignment_id as string);
          if (!k) {
            warnings.push(
              `${where}: assignment block without an assignment of this course, left out`,
            );
            return null;
          }
          return { type: "assignment", assignment: k };
        }
        case "quiz": {
          const k = quizKey.get(p.quiz_id as string);
          if (!k) {
            warnings.push(`${where}: quiz block without a quiz of this course, left out`);
            return null;
          }
          return { type: "quiz", quiz: k };
        }
        case "embed":
          if (typeof p.url !== "string" || !p.url) {
            warnings.push(`${where}: embed block without a URL, left out`);
            return null;
          }
          return {
            type: "embed",
            url: p.url,
            title: (p.title as string | null | undefined) ?? null,
          };
      }
    };

    const chapterOut: BundleCourse["chapters"] = [];
    for (const ch of chapters) {
      const lessonsOut: BundleCourse["chapters"][number]["lessons"] = [];
      for (const l of lessons.filter((x) => x.chapterId === ch.id)) {
        const where = `course ${c.slug}, lesson ${ch.slug}/${l.slug}`;
        const out: BundleBlock[] = [];
        for (const b of blocks.filter((x) => x.lessonId === l.id)) {
          const converted = await blockOut(b, where);
          if (converted) out.push(converted);
        }
        lessonsOut.push({
          slug: l.slug,
          title: l.title,
          summary: l.summary,
          status: l.status,
          estimated_minutes: l.estimatedMinutes,
          blocks: out,
        });
      }
      chapterOut.push({
        slug: ch.slug,
        title: ch.title,
        description_md: md(ch.descriptionMd),
        lessons: lessonsOut,
      });
    }

    let cohortsOut: BundleCourse["cohorts"];
    if (opts.cohorts) {
      const cohorts = await tx
        .select()
        .from(cohort)
        .where(eq(cohort.courseId, c.id))
        .orderBy(asc(cohort.slug));
      const lessonPath = new Map(
        lessons.map((l) => [l.id, `${chapters.find((x) => x.id === l.chapterId)!.slug}/${l.slug}`]),
      );
      const chapterSlug = new Map(chapters.map((x) => [x.id, x.slug]));
      cohortsOut = [];
      for (const g of cohorts) {
        const releases = await tx
          .select()
          .from(cohortRelease)
          .where(eq(cohortRelease.cohortId, g.id))
          .orderBy(asc(cohortRelease.releaseAt), asc(cohortRelease.id));
        cohortsOut.push({
          slug: g.slug,
          external_ref: g.externalRef,
          title: g.title,
          starts_at: g.startsAt,
          ends_at: g.endsAt,
          status: g.status,
          releases: releases.flatMap(
            (r): NonNullable<BundleCourse["cohorts"]>[number]["releases"] => {
              const at = r.releaseAt.toISOString();
              if (r.chapterId && chapterSlug.has(r.chapterId))
                return [{ chapter: chapterSlug.get(r.chapterId)!, release_at: at }];
              if (r.lessonId && lessonPath.has(r.lessonId))
                return [{ lesson: lessonPath.get(r.lessonId)!, release_at: at }];
              return [];
            },
          ),
        });
      }
    }

    courses.push({
      slug: c.slug,
      external_ref: c.externalRef,
      title: c.title,
      subtitle: c.subtitle,
      description_md: md(c.descriptionMd),
      language: c.language,
      status: c.status,
      ended_at: c.endedAt,
      sort: c.sort,
      forum_enabled: c.forumEnabled,
      cover_image: cover,
      chapters: chapterOut,
      assignments: assignments.map((a) => ({
        key: assignmentKey.get(a.id)!,
        title: a.title,
        instructions_md: md(a.instructionsMd),
        submission_type: a.submissionType,
        allow_resubmit: a.allowResubmit,
      })),
      quizzes: quizzes.map((q) => ({
        key: quizKey.get(q.id)!,
        title: q.title,
        intro_md: md(q.introMd),
        kind: q.kind,
        show_answers_after_submit: q.showAnswersAfterSubmit,
        pass_threshold: q.passThreshold,
        questions: questions
          .filter((x) => x.quizId === q.id)
          .map((x) => ({
            type: x.type,
            prompt_md: md(x.promptMd),
            required: x.required,
            options: options
              .filter((o) => o.questionId === x.id)
              .map((o) => ({ label: o.label, is_correct: o.isCorrect })),
          })),
      })),
      ...(cohortsOut ? { cohorts: cohortsOut } : {}),
    });
  }

  const bundle = parseBundle({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exported_at: (opts.now ?? new Date()).toISOString(),
    sota_version: opts.version,
    courses,
    media,
  });
  return { bundle, files, warnings };
}
