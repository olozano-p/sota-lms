/**
 * The content bundle (`sota-content/v1`, ADR-021): courses with chapters, lessons, blocks,
 * assignments, quizzes and, optionally, cohorts with their drip releases, as JSON, plus the media
 * files they reference. Never people, enrollments, submissions or progress. Rows are identified by
 * slug (and `external_ref`), never by database id: blocks point at assignments and quizzes by a
 * bundle-local `key` and at files by a media id (`m1`), inline images in Markdown use the token
 * `sota-media:m1`. Pure and plain-Node safe: the export, the import and the tests share it.
 */
import { z } from "zod";
import { SLUG_PATTERN } from "./slug.ts";

export const BUNDLE_FORMAT = "sota-content";
export const BUNDLE_VERSION = 1;
export const BUNDLE_FILE = "sota-export.json";
export const MEDIA_DIR = "media";
/** `forum` is reserved as a lesson slug: the course forum lives under it. */
export const RESERVED_LESSON_SLUG = "forum";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(SLUG_PATTERN, "lower-case letters, digits and hyphens");
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/, "a short lower-case key such as a1 or q-intro");
const mediaId = z.string().regex(/^m\d{1,6}$/, "a media id such as m1");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a YYYY-MM-DD date");
const instant = z.string().datetime({ offset: true });
const md = z.string().max(200_000);

export const mediaSchema = z.strictObject({
  id: mediaId,
  /** Relative to the bundle directory, always `media/<name>`; never a path that leaves it. */
  path: z.string().regex(/^media\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const blockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), md }),
  z.strictObject({
    type: z.literal("video"),
    provider: z.string().min(1),
    external_id: z.string().min(1),
    title: z.string(),
    duration_s: z.number().nullable(),
    thumbnail_url: z.string().nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("audio"),
    media: mediaId.nullable(),
    title: z.string(),
    duration_s: z.number().nullable(),
  }),
  z.strictObject({
    type: z.literal("file"),
    media: mediaId.nullable(),
    title: z.string(),
    mime: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("assignment"), assignment: key }),
  z.strictObject({ type: z.literal("quiz"), quiz: key }),
  z.strictObject({
    type: z.literal("embed"),
    url: z.string().url(),
    title: z.string().nullable().optional(),
  }),
]);
export type BundleBlock = z.infer<typeof blockSchema>;

const lessonSchema = z.strictObject({
  slug: slug.refine((s) => s !== RESERVED_LESSON_SLUG, `"${RESERVED_LESSON_SLUG}" is reserved`),
  title: z.string().min(1).max(300),
  summary: z.string().nullable(),
  status: z.enum(["draft", "published"]),
  estimated_minutes: z.number().int().nonnegative().nullable(),
  blocks: z.array(blockSchema).max(500),
});

const chapterSchema = z.strictObject({
  slug,
  title: z.string().min(1).max(300),
  description_md: md,
  lessons: z.array(lessonSchema).max(1000),
});

const assignmentSchema = z.strictObject({
  key,
  title: z.string().min(1).max(300),
  instructions_md: md,
  submission_type: z.enum(["text", "file", "both"]),
  allow_resubmit: z.boolean(),
});

const questionSchema = z.strictObject({
  type: z.enum(["single_choice", "multi_choice", "short_text", "long_text"]),
  prompt_md: md,
  required: z.boolean(),
  options: z.array(z.strictObject({ label: z.string(), is_correct: z.boolean() })).max(100),
});

const quizSchema = z.strictObject({
  key,
  title: z.string().min(1).max(300),
  intro_md: md,
  kind: z.enum(["form", "self_check"]),
  show_answers_after_submit: z.boolean(),
  pass_threshold: z.number().min(0).max(100).nullable(),
  questions: z.array(questionSchema).max(500),
});

const releaseSchema = z
  .strictObject({
    /** Slug of a chapter of the course. */
    chapter: slug.optional(),
    /** `<chapter slug>/<lesson slug>`. */
    lesson: z
      .string()
      .regex(/^[a-z0-9-]+\/[a-z0-9-]+$/)
      .optional(),
    release_at: instant,
  })
  .refine(
    (r) => (r.chapter === undefined) !== (r.lesson === undefined),
    "exactly one of chapter or lesson",
  );

const cohortSchema = z.strictObject({
  slug,
  external_ref: z.string().min(1).nullable(),
  title: z.string().min(1).max(300),
  starts_at: date.nullable(),
  ends_at: date.nullable(),
  status: z.enum(["upcoming", "active", "closed"]),
  releases: z.array(releaseSchema).max(5000),
});

export const courseSchema = z.strictObject({
  slug,
  external_ref: z.string().min(1).nullable(),
  title: z.string().min(1).max(300),
  subtitle: z.string().nullable(),
  description_md: md,
  language: z.string().min(1).max(20),
  status: z.enum(["draft", "published", "archived"]),
  ended_at: date.nullable(),
  sort: z.number().int(),
  forum_enabled: z.boolean(),
  cover_image: mediaId.nullable(),
  chapters: z.array(chapterSchema).max(500),
  assignments: z.array(assignmentSchema).max(1000),
  quizzes: z.array(quizSchema).max(1000),
  /** Present only when the export was asked for cohorts. */
  cohorts: z.array(cohortSchema).max(500).optional(),
});
export type BundleCourse = z.infer<typeof courseSchema>;

export const bundleSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  exported_at: instant,
  sota_version: z.string(),
  courses: z.array(courseSchema).min(1).max(200),
  media: z.array(mediaSchema).max(20_000),
});
export type Bundle = z.infer<typeof bundleSchema>;

export class BundleError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid content bundle:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "BundleError";
    this.problems = problems;
  }
}

// ---------- Media references inside Markdown ----------

const FILE_URL = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const MEDIA_TOKEN = /sota-media:(m\d{1,6})/g;

/** Replaces each `/api/files/<id>` by what `to` returns for the id (null keeps the original). */
export function replaceFileUrls(text: string, to: (fileId: string) => string | null): string {
  return text.replace(FILE_URL, (whole, id: string) => to(id.toLowerCase()) ?? whole);
}
/** Replaces each `sota-media:<id>` by what `to` returns for the media id (null keeps the token). */
export function replaceMediaTokens(text: string, to: (mediaId: string) => string | null): string {
  return text.replace(MEDIA_TOKEN, (whole, id: string) => to(id) ?? whole);
}
export const fileUrlsIn = (text: string): string[] =>
  [...text.matchAll(FILE_URL)].map((m) => m[1]!.toLowerCase());
export const mediaTokensIn = (text: string): string[] =>
  [...text.matchAll(MEDIA_TOKEN)].map((m) => m[1]!);

/** Every Markdown field of a course, with a label for error messages. */
export function markdownFields(course: BundleCourse): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: "description_md", text: course.description_md },
  ];
  for (const ch of course.chapters) {
    out.push({ where: `chapter ${ch.slug}`, text: ch.description_md });
    for (const l of ch.lessons)
      l.blocks.forEach((b, i) => {
        if (b.type === "text")
          out.push({ where: `lesson ${ch.slug}/${l.slug} block ${i + 1}`, text: b.md });
      });
  }
  for (const a of course.assignments)
    out.push({ where: `assignment ${a.key}`, text: a.instructions_md });
  for (const q of course.quizzes) {
    out.push({ where: `quiz ${q.key}`, text: q.intro_md });
    q.questions.forEach((x, i) =>
      out.push({ where: `quiz ${q.key} question ${i + 1}`, text: x.prompt_md }),
    );
  }
  return out;
}

/**
 * Parses and cross-checks a bundle before anything is written: the schema, unique slugs and keys,
 * every block, release and Markdown token pointing at something that exists in the bundle, and
 * every media entry being used at most under one id. Throws a `BundleError` listing every problem.
 */
export function parseBundle(input: unknown): Bundle {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) {
    throw new BundleError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const bundle = parsed.data;
  const problems: string[] = [];
  const dup = (what: string, values: string[]) => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) problems.push(`${what} "${v}" appears twice`);
      seen.add(v);
    }
  };
  const mediaIds = new Set(bundle.media.map((m) => m.id));
  dup(
    "media id",
    bundle.media.map((m) => m.id),
  );
  dup(
    "media path",
    bundle.media.map((m) => m.path),
  );
  dup(
    "course slug",
    bundle.courses.map((c) => c.slug),
  );
  dup(
    "course external_ref",
    bundle.courses.flatMap((c) => (c.external_ref ? [c.external_ref] : [])),
  );
  dup(
    "cohort slug",
    bundle.courses.flatMap((c) => (c.cohorts ?? []).map((g) => g.slug)),
  );

  for (const c of bundle.courses) {
    const at = `course ${c.slug}`;
    dup(
      `${at}: chapter slug`,
      c.chapters.map((ch) => ch.slug),
    );
    dup(
      `${at}: assignment key`,
      c.assignments.map((a) => a.key),
    );
    dup(
      `${at}: quiz key`,
      c.quizzes.map((q) => q.key),
    );
    const lessons = new Set<string>();
    for (const ch of c.chapters) {
      dup(
        `${at}: lesson slug in ${ch.slug}`,
        ch.lessons.map((l) => l.slug),
      );
      for (const l of ch.lessons) {
        lessons.add(`${ch.slug}/${l.slug}`);
        l.blocks.forEach((b, i) => {
          const here = `${at}: lesson ${ch.slug}/${l.slug} block ${i + 1}`;
          if ((b.type === "audio" || b.type === "file") && b.media && !mediaIds.has(b.media))
            problems.push(`${here}: unknown media "${b.media}"`);
          if (b.type === "assignment" && !c.assignments.some((a) => a.key === b.assignment))
            problems.push(`${here}: unknown assignment "${b.assignment}"`);
          if (b.type === "quiz" && !c.quizzes.some((q) => q.key === b.quiz))
            problems.push(`${here}: unknown quiz "${b.quiz}"`);
        });
      }
    }
    if (c.cover_image && !mediaIds.has(c.cover_image))
      problems.push(`${at}: unknown cover media "${c.cover_image}"`);
    for (const f of markdownFields(c))
      for (const id of mediaTokensIn(f.text))
        if (!mediaIds.has(id)) problems.push(`${at}: ${f.where} refers to unknown media "${id}"`);
    for (const q of c.quizzes)
      q.questions.forEach((x, i) => {
        const choice = x.type === "single_choice" || x.type === "multi_choice";
        if (!choice && x.options.length)
          problems.push(`${at}: quiz ${q.key} question ${i + 1} is free text but has options`);
        if (x.type === "single_choice" && x.options.filter((o) => o.is_correct).length > 1)
          problems.push(
            `${at}: quiz ${q.key} question ${i + 1} is single choice with several correct options`,
          );
      });
    for (const g of c.cohorts ?? []) {
      dup(
        `${at}: cohort ${g.slug} release target`,
        g.releases.map((r) => r.chapter ?? r.lesson!),
      );
      for (const r of g.releases) {
        if (r.chapter && !c.chapters.some((ch) => ch.slug === r.chapter))
          problems.push(`${at}: cohort ${g.slug} releases unknown chapter "${r.chapter}"`);
        if (r.lesson && !lessons.has(r.lesson))
          problems.push(`${at}: cohort ${g.slug} releases unknown lesson "${r.lesson}"`);
      }
    }
  }
  if (problems.length) throw new BundleError(problems);
  return bundle;
}
