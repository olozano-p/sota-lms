/**
 * Course → chapter → lesson → block authoring. Every function authorises through
 * `requireCourseTeacher()` (admins pass) and appends an audit row inside its transaction.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx } from "~/db";
import {
  BLOCK_TYPES,
  COURSE_STATUSES,
  LESSON_STATUSES,
  chapter,
  course,
  courseTeacher,
  file,
  lesson,
  lessonBlock,
  type BlockType,
} from "~/db/schema";
import { lmsConfig } from "~/config";
import { SLUG_PATTERN, slugify } from "~/lib/slug";
import { audit } from "~/server/audit";
import { requireCourseTeacher, requireRole } from "~/server/auth/authz";
import { assertBlockReferences, blockPayloadSchemas, embedAllowed } from "~/server/services/blocks";
import { headObject, signedPutUrl } from "~/server/services/files";
import { videoProvider } from "~/server/services/video";

const id = z.string().uuid();
const title = z.string().trim().min(1).max(200);

async function courseIdOfChapter(chapterId: string): Promise<string> {
  const [row] = await db
    .select({ courseId: chapter.courseId })
    .from(chapter)
    .where(eq(chapter.id, chapterId))
    .limit(1);
  if (!row) throw new Error("chapter not found");
  return row.courseId;
}
async function courseIdOfLesson(
  lessonId: string,
): Promise<{ courseId: string; chapterId: string }> {
  const [row] = await db
    .select({ courseId: chapter.courseId, chapterId: chapter.id })
    .from(lesson)
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .where(eq(lesson.id, lessonId))
    .limit(1);
  if (!row) throw new Error("lesson not found");
  return row;
}
async function courseIdOfBlock(blockId: string): Promise<{ courseId: string; lessonId: string }> {
  const [row] = await db
    .select({ courseId: chapter.courseId, lessonId: lessonBlock.lessonId })
    .from(lessonBlock)
    .innerJoin(lesson, eq(lesson.id, lessonBlock.lessonId))
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .where(eq(lessonBlock.id, blockId))
    .limit(1);
  if (!row) throw new Error("block not found");
  return row;
}

/** Segments that are routes of their own under a course, so no lesson may take them. */
const RESERVED_LESSON_SLUGS = ["forum"];

/** `title` → slug, made unique among `taken`. */
function uniqueSlug(base: string, taken: string[]): string {
  const root = slugify(base) || "item";
  if (!taken.includes(root)) return root;
  let n = 2;
  while (taken.includes(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

// ---------- Courses ----------

export const createCourse = createServerFn({ method: "POST" })
  .validator(z.object({ title, language: z.string().min(2).max(10) }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    return db.transaction(async (tx) => {
      const taken = (await tx.select({ slug: course.slug }).from(course)).map((r) => r.slug);
      const [max] = await tx
        .select({ m: sql<number>`coalesce(max(${course.sort}), 0)`.mapWith(Number) })
        .from(course);
      const [row] = await tx
        .insert(course)
        .values({
          title: data.title,
          slug: uniqueSlug(data.title, taken),
          language: data.language,
          sort: (max?.m ?? 0) + 1,
        })
        .returning();
      await audit(tx, {
        actorId: admin.id,
        action: "course.create",
        entity: "course",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateCourse = createServerFn({ method: "POST" })
  .validator(
    z.object({
      courseId: id,
      patch: z
        .object({
          title,
          slug: z.string().regex(SLUG_PATTERN),
          subtitle: z.string().trim().max(300).nullable(),
          descriptionMd: z.string().max(50_000),
          language: z.string().min(2).max(10),
          status: z.enum(COURSE_STATUSES),
          endedAt: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          forumEnabled: z.boolean(),
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(course).where(eq(course.id, data.courseId)).limit(1);
      if (!before) throw new Error("course not found");
      if (data.patch.slug && data.patch.slug !== before.slug) {
        const clash = await tx
          .select({ id: course.id })
          .from(course)
          .where(and(eq(course.slug, data.patch.slug), ne(course.id, before.id)))
          .limit(1);
        if (clash[0]) throw new Error("slug already in use");
      }
      const [after] = await tx
        .update(course)
        .set(data.patch)
        .where(eq(course.id, data.courseId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "course.update",
        entity: "course",
        entityId: before.id,
        before,
        after,
      });
      return after!;
    });
  });

export const setCourseTeachers = createServerFn({ method: "POST" })
  .validator(z.object({ courseId: id, personIds: z.array(id) }))
  .handler(async ({ data }) => {
    const admin = await requireRole("admin");
    return db.transaction(async (tx) => {
      const before = (
        await tx
          .select({ personId: courseTeacher.personId })
          .from(courseTeacher)
          .where(eq(courseTeacher.courseId, data.courseId))
      ).map((r) => r.personId);
      await tx.delete(courseTeacher).where(eq(courseTeacher.courseId, data.courseId));
      if (data.personIds.length)
        await tx
          .insert(courseTeacher)
          .values(data.personIds.map((personId) => ({ courseId: data.courseId, personId })));
      await audit(tx, {
        actorId: admin.id,
        action: "course.teachers",
        entity: "course",
        entityId: data.courseId,
        before,
        after: data.personIds,
      });
      return { ok: true };
    });
  });

// ---------- Chapters ----------

async function renumber(
  tx: DbOrTx,
  table: typeof chapter | typeof lesson | typeof lessonBlock,
  parentCol: "courseId" | "chapterId" | "lessonId",
  parentId: string,
  orderedIds: string[],
) {
  const col =
    table === chapter
      ? chapter.courseId
      : table === lesson
        ? lesson.chapterId
        : lessonBlock.lessonId;
  void parentCol;
  const existing = (await tx.select({ id: table.id }).from(table).where(eq(col, parentId))).map(
    (r) => r.id,
  );
  const missing = existing.filter((x) => !orderedIds.includes(x));
  const finalOrder = [...orderedIds.filter((x) => existing.includes(x)), ...missing];
  for (const [i, rowId] of finalOrder.entries()) {
    await tx
      .update(table)
      .set({ sort: i + 1 })
      .where(eq(table.id, rowId));
  }
}

export const createChapter = createServerFn({ method: "POST" })
  .validator(z.object({ courseId: id, title }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ slug: chapter.slug, sort: chapter.sort })
        .from(chapter)
        .where(eq(chapter.courseId, data.courseId));
      const [row] = await tx
        .insert(chapter)
        .values({
          courseId: data.courseId,
          title: data.title,
          slug: uniqueSlug(
            data.title,
            siblings.map((s) => s.slug),
          ),
          sort: Math.max(0, ...siblings.map((s) => s.sort)) + 1,
        })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "chapter.create",
        entity: "chapter",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateChapter = createServerFn({ method: "POST" })
  .validator(
    z.object({
      chapterId: id,
      patch: z.object({ title, descriptionMd: z.string().max(20_000) }).partial(),
    }),
  )
  .handler(async ({ data }) => {
    const courseId = await courseIdOfChapter(data.chapterId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(chapter)
        .where(eq(chapter.id, data.chapterId))
        .limit(1);
      const [after] = await tx
        .update(chapter)
        .set(data.patch)
        .where(eq(chapter.id, data.chapterId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "chapter.update",
        entity: "chapter",
        entityId: data.chapterId,
        before,
        after,
      });
      return after!;
    });
  });

export const deleteChapter = createServerFn({ method: "POST" })
  .validator(z.object({ chapterId: id }))
  .handler(async ({ data }) => {
    const courseId = await courseIdOfChapter(data.chapterId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(chapter)
        .where(eq(chapter.id, data.chapterId))
        .limit(1);
      await tx.delete(chapter).where(eq(chapter.id, data.chapterId));
      await audit(tx, {
        actorId: user.id,
        action: "chapter.delete",
        entity: "chapter",
        entityId: data.chapterId,
        before,
      });
      return { ok: true };
    });
  });

export const reorderChapters = createServerFn({ method: "POST" })
  .validator(z.object({ courseId: id, orderedIds: z.array(id) }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    return db.transaction(async (tx) => {
      await renumber(tx, chapter, "courseId", data.courseId, data.orderedIds);
      await audit(tx, {
        actorId: user.id,
        action: "chapter.reorder",
        entity: "course",
        entityId: data.courseId,
        after: data.orderedIds,
      });
      return { ok: true };
    });
  });

// ---------- Lessons ----------

export const createLesson = createServerFn({ method: "POST" })
  .validator(z.object({ chapterId: id, title }))
  .handler(async ({ data }) => {
    const courseId = await courseIdOfChapter(data.chapterId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ slug: lesson.slug, sort: lesson.sort })
        .from(lesson)
        .where(eq(lesson.chapterId, data.chapterId));
      // Lesson slugs are unique per course (they live under /courses/$courseSlug/$lessonSlug).
      const courseSlugs = (
        await tx
          .select({ slug: lesson.slug })
          .from(lesson)
          .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
          .where(eq(chapter.courseId, courseId))
      ).map((r) => r.slug);
      const [row] = await tx
        .insert(lesson)
        .values({
          chapterId: data.chapterId,
          title: data.title,
          slug: uniqueSlug(data.title, [...courseSlugs, ...RESERVED_LESSON_SLUGS]),
          sort: Math.max(0, ...siblings.map((s) => s.sort)) + 1,
        })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "lesson.create",
        entity: "lesson",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateLesson = createServerFn({ method: "POST" })
  .validator(
    z.object({
      lessonId: id,
      patch: z
        .object({
          title,
          slug: z.string().regex(SLUG_PATTERN),
          summary: z.string().trim().max(500).nullable(),
          estimatedMinutes: z.number().int().min(0).max(10_000).nullable(),
          status: z.enum(LESSON_STATUSES),
          chapterId: id,
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const { courseId } = await courseIdOfLesson(data.lessonId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(lesson).where(eq(lesson.id, data.lessonId)).limit(1);
      if (!before) throw new Error("lesson not found");
      if (data.patch.chapterId && data.patch.chapterId !== before.chapterId) {
        if ((await courseIdOfChapter(data.patch.chapterId)) !== courseId)
          throw new Error("chapter belongs to another course");
        const [max] = await tx
          .select({ m: sql<number>`coalesce(max(${lesson.sort}), 0)`.mapWith(Number) })
          .from(lesson)
          .where(eq(lesson.chapterId, data.patch.chapterId));
        (data.patch as { sort?: number }).sort = (max?.m ?? 0) + 1;
      }
      if (data.patch.slug && data.patch.slug !== before.slug) {
        if (RESERVED_LESSON_SLUGS.includes(data.patch.slug))
          throw new Error("slug reserved for a course page");
        const clash = await tx
          .select({ id: lesson.id })
          .from(lesson)
          .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
          .where(
            and(
              eq(chapter.courseId, courseId),
              eq(lesson.slug, data.patch.slug),
              ne(lesson.id, before.id),
            ),
          )
          .limit(1);
        if (clash[0]) throw new Error("slug already in use in this course");
      }
      const [after] = await tx
        .update(lesson)
        .set(data.patch)
        .where(eq(lesson.id, data.lessonId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "lesson.update",
        entity: "lesson",
        entityId: data.lessonId,
        before,
        after,
      });
      return after!;
    });
  });

export const deleteLesson = createServerFn({ method: "POST" })
  .validator(z.object({ lessonId: id }))
  .handler(async ({ data }) => {
    const { courseId } = await courseIdOfLesson(data.lessonId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(lesson).where(eq(lesson.id, data.lessonId)).limit(1);
      await tx.delete(lesson).where(eq(lesson.id, data.lessonId));
      await audit(tx, {
        actorId: user.id,
        action: "lesson.delete",
        entity: "lesson",
        entityId: data.lessonId,
        before,
      });
      return { ok: true };
    });
  });

export const reorderLessons = createServerFn({ method: "POST" })
  .validator(z.object({ chapterId: id, orderedIds: z.array(id) }))
  .handler(async ({ data }) => {
    const courseId = await courseIdOfChapter(data.chapterId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      await renumber(tx, lesson, "chapterId", data.chapterId, data.orderedIds);
      await audit(tx, {
        actorId: user.id,
        action: "lesson.reorder",
        entity: "chapter",
        entityId: data.chapterId,
        after: data.orderedIds,
      });
      return { ok: true };
    });
  });

// ---------- Blocks ----------

const defaultPayload: Record<BlockType, unknown> = {
  text: { md: "" },
  video: { provider: "vimeo", external_id: "", title: "", duration_s: null, thumbnail_url: null },
  audio: { file_key: "", title: "", duration_s: null },
  file: { file_key: "", title: "", mime: "", size: 0 },
  embed: { url: "", title: null },
  assignment: { assignment_id: "" },
  quiz: { quiz_id: "" },
};

export const createBlock = createServerFn({ method: "POST" })
  .validator(
    z.object({ lessonId: id, type: z.enum(BLOCK_TYPES), afterSort: z.number().int().optional() }),
  )
  .handler(async ({ data }) => {
    const { courseId } = await courseIdOfLesson(data.lessonId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ id: lessonBlock.id, sort: lessonBlock.sort })
        .from(lessonBlock)
        .where(eq(lessonBlock.lessonId, data.lessonId))
        .orderBy(asc(lessonBlock.sort));
      const [row] = await tx
        .insert(lessonBlock)
        .values({
          lessonId: data.lessonId,
          type: data.type,
          sort: siblings.length + 1,
          payload: defaultPayload[data.type] as never,
        })
        .returning();
      if (data.afterSort !== undefined) {
        const ids = siblings.map((s) => s.id);
        const at = siblings.findIndex((s) => s.sort === data.afterSort);
        ids.splice(at + 1, 0, row!.id);
        await renumber(tx, lessonBlock, "lessonId", data.lessonId, ids);
      }
      await audit(tx, {
        actorId: user.id,
        action: "block.create",
        entity: "lesson_block",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

/** Payloads are validated per type; incomplete drafts are allowed (empty ids/keys) so autosave never fails mid-edit. */
export const updateBlock = createServerFn({ method: "POST" })
  .validator(z.object({ blockId: id, payload: z.record(z.string(), z.unknown()) }))
  .handler(async ({ data }) => {
    const { courseId } = await courseIdOfBlock(data.blockId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(lessonBlock)
        .where(eq(lessonBlock.id, data.blockId))
        .limit(1);
      if (!before) throw new Error("block not found");
      const schema = blockPayloadSchemas[before.type];
      const lenient = schema instanceof z.ZodObject ? schema.partial() : schema;
      const payload = lenient.parse(data.payload) as Record<string, unknown>;
      await assertBlockReferences(tx, before.type, payload, courseId);
      if (
        before.type === "embed" &&
        typeof payload.url === "string" &&
        payload.url &&
        !embedAllowed(payload.url)
      ) {
        throw new Error(`embed host not allowed; allowed: ${lmsConfig.embedAllowlist.join(", ")}`);
      }
      const [after] = await tx
        .update(lessonBlock)
        .set({ payload: { ...(before.payload as object), ...payload } as never })
        .where(eq(lessonBlock.id, data.blockId))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "block.update",
        entity: "lesson_block",
        entityId: data.blockId,
        before: before.payload,
        after: after!.payload,
      });
      return { ...after!, payload: JSON.stringify(after!.payload) };
    });
  });

export const deleteBlock = createServerFn({ method: "POST" })
  .validator(z.object({ blockId: id }))
  .handler(async ({ data }) => {
    const { courseId, lessonId } = await courseIdOfBlock(data.blockId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(lessonBlock)
        .where(eq(lessonBlock.id, data.blockId))
        .limit(1);
      await tx.delete(lessonBlock).where(eq(lessonBlock.id, data.blockId));
      const rest = (
        await tx
          .select({ id: lessonBlock.id })
          .from(lessonBlock)
          .where(eq(lessonBlock.lessonId, lessonId))
          .orderBy(asc(lessonBlock.sort))
      ).map((r) => r.id);
      await renumber(tx, lessonBlock, "lessonId", lessonId, rest);
      await audit(tx, {
        actorId: user.id,
        action: "block.delete",
        entity: "lesson_block",
        entityId: data.blockId,
        before,
      });
      return { ok: true };
    });
  });

export const reorderBlocks = createServerFn({ method: "POST" })
  .validator(z.object({ lessonId: id, orderedIds: z.array(id) }))
  .handler(async ({ data }) => {
    const { courseId } = await courseIdOfLesson(data.lessonId);
    const user = await requireCourseTeacher(courseId);
    return db.transaction(async (tx) => {
      await renumber(tx, lessonBlock, "lessonId", data.lessonId, data.orderedIds);
      await audit(tx, {
        actorId: user.id,
        action: "block.reorder",
        entity: "lesson",
        entityId: data.lessonId,
        after: data.orderedIds,
      });
      return { ok: true };
    });
  });

// ---------- Uploads and video ----------

/** Step 1: the browser asks for a presigned PUT. Limits and mime allowlist come from config. */
export const requestUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      courseId: id,
      filename: z.string().min(1).max(255),
      mime: z.string().min(1),
      size: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    await requireCourseTeacher(data.courseId);
    if (data.size > lmsConfig.uploads.maxBytes)
      throw new Error(
        `file too large (max ${Math.round(lmsConfig.uploads.maxBytes / 1_048_576)} MB)`,
      );
    if (!lmsConfig.uploads.allowedMime.includes(data.mime))
      throw new Error(`type not allowed: ${data.mime}`);
    const safeName = data.filename.replace(/[^\w.-]+/g, "_").slice(-120);
    const key = `courses/${data.courseId}/${uuidv7()}-${safeName}`;
    return { key, url: await signedPutUrl(key, data.mime, data.size) };
  });

/** Step 2: after the PUT, the server confirms the object and records the file. */
export const confirmUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({ courseId: id, key: z.string().min(1), filename: z.string().min(1).max(255) }),
  )
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    if (!data.key.startsWith(`courses/${data.courseId}/`))
      throw new Error("key outside the course");
    const head = await headObject(data.key);
    if (!head) throw new Error("object not found after upload");
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(file)
        .values({
          key: data.key,
          filename: data.filename,
          mime: head.mime,
          size: head.size,
          uploadedBy: user.id,
        })
        .onConflictDoNothing({ target: file.key })
        .returning();
      const rec = row ?? (await tx.select().from(file).where(eq(file.key, data.key)).limit(1))[0]!;
      await audit(tx, {
        actorId: user.id,
        action: "file.upload",
        entity: "file",
        entityId: rec.id,
        after: { key: rec.key, mime: rec.mime, size: rec.size },
      });
      return { id: rec.id, key: rec.key, filename: rec.filename, mime: rec.mime, size: rec.size };
    });
  });

export const resolveVideo = createServerFn({ method: "POST" })
  .validator(z.object({ courseId: id, provider: z.string().min(1), input: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireCourseTeacher(data.courseId);
    return videoProvider(data.provider).resolve(data.input);
  });

export { inArray };
