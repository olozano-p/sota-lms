import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import {
  assignment,
  chapter,
  course,
  courseTeacher,
  lesson,
  lessonBlock,
  person,
  quiz,
} from "~/db/schema";
import { lmsConfig } from "~/config";
import { renderMarkdown } from "~/lib/markdown";
import { hasRole, requireCourseTeacher, requireRole } from "~/server/auth/authz";
import { enabledVideoProviders } from "~/server/services/video";

/** Courses the caller may author: all for admins, assigned ones for teachers. */
export const listTeachCourses = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireRole("teacher");
  const admin = hasRole(user, "admin");
  const rows = await db
    .select({
      id: course.id,
      slug: course.slug,
      title: course.title,
      subtitle: course.subtitle,
      status: course.status,
      language: course.language,
      updatedAt: course.updatedAt,
      lessonCount:
        sql<number>`(select count(*) from ${lesson} l join ${chapter} c on c.id = l.chapter_id where c.course_id = ${sql.raw('"course"."id"')})`.mapWith(
          Number,
        ),
      publishedCount:
        sql<number>`(select count(*) from ${lesson} l join ${chapter} c on c.id = l.chapter_id where c.course_id = ${sql.raw('"course"."id"')} and l.status = 'published')`.mapWith(
          Number,
        ),
    })
    .from(course)
    .where(
      admin
        ? undefined
        : inArray(
            course.id,
            db
              .select({ id: courseTeacher.courseId })
              .from(courseTeacher)
              .where(eq(courseTeacher.personId, user.id)),
          ),
    )
    .orderBy(asc(course.sort), asc(course.title));
  return { courses: rows, isAdmin: admin, languages: lmsConfig.locales.enabled };
});

export const getCourseEditor = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const [c] = await db.select().from(course).where(eq(course.slug, data.slug)).limit(1);
    if (!c) return null;
    const user = await requireCourseTeacher(c.id);
    const isAdmin = hasRole(user, "admin");
    const [teachers, chapters, lessons, candidates] = await Promise.all([
      db
        .select({ id: person.id, name: person.name, email: person.email })
        .from(courseTeacher)
        .innerJoin(person, eq(person.id, courseTeacher.personId))
        .where(eq(courseTeacher.courseId, c.id))
        .orderBy(asc(person.name)),
      db.select().from(chapter).where(eq(chapter.courseId, c.id)).orderBy(asc(chapter.sort)),
      db
        .select({
          id: lesson.id,
          chapterId: lesson.chapterId,
          slug: lesson.slug,
          title: lesson.title,
          status: lesson.status,
          sort: lesson.sort,
          estimatedMinutes: lesson.estimatedMinutes,
          blockCount:
            sql<number>`(select count(*) from ${lessonBlock} b where b.lesson_id = ${sql.raw('"lesson"."id"')})`.mapWith(
              Number,
            ),
        })
        .from(lesson)
        .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
        .where(eq(chapter.courseId, c.id))
        .orderBy(asc(lesson.sort)),
      isAdmin
        ? db
            .select({ id: person.id, name: person.name, email: person.email })
            .from(person)
            .where(sql`${person.roles} && array['teacher','admin']::text[]`)
            .orderBy(asc(person.name))
        : Promise.resolve([]),
    ]);
    return {
      course: c,
      isAdmin,
      teachers,
      candidates,
      languages: lmsConfig.locales.enabled,
      chapters: chapters.map((ch) => ({
        ...ch,
        lessons: lessons.filter((l) => l.chapterId === ch.id),
      })),
    };
  });

export const getLessonEditor = createServerFn({ method: "GET" })
  .validator(z.object({ lessonId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select({ lesson, chapter, course })
      .from(lesson)
      .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
      .innerJoin(course, eq(course.id, chapter.courseId))
      .where(eq(lesson.id, data.lessonId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    await requireCourseTeacher(row.course.id);
    const [blocks, chapters, assignments, quizzes] = await Promise.all([
      db
        .select()
        .from(lessonBlock)
        .where(eq(lessonBlock.lessonId, row.lesson.id))
        .orderBy(asc(lessonBlock.sort)),
      db
        .select({ id: chapter.id, title: chapter.title })
        .from(chapter)
        .where(eq(chapter.courseId, row.course.id))
        .orderBy(asc(chapter.sort)),
      db
        .select({ id: assignment.id, title: assignment.title })
        .from(assignment)
        .where(eq(assignment.courseId, row.course.id))
        .orderBy(asc(assignment.title)),
      db
        .select({ id: quiz.id, title: quiz.title, kind: quiz.kind })
        .from(quiz)
        .where(eq(quiz.courseId, row.course.id))
        .orderBy(asc(quiz.title)),
    ]);
    return {
      course: { id: row.course.id, slug: row.course.slug, title: row.course.title },
      chapter: { id: row.chapter.id, title: row.chapter.title },
      chapters,
      lesson: row.lesson,
      blocks: blocks.map((b) => ({
        id: b.id,
        sort: b.sort,
        type: b.type,
        payload: JSON.stringify(b.payload),
      })),
      assignments,
      quizzes,
      uploads: lmsConfig.uploads,
      embedAllowlist: lmsConfig.embedAllowlist,
      providers: enabledVideoProviders().map((p) => p.id),
    };
  });

/** Live preview for the Markdown editor; the same sanitiser the player uses. */
export const previewMarkdown = createServerFn({ method: "POST" })
  .validator(z.object({ md: z.string().max(200_000) }))
  .handler(async ({ data }) => {
    await requireRole("teacher");
    return { html: renderMarkdown(data.md) };
  });

export { and };
