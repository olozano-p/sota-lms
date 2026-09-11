import { createServerFn } from "@tanstack/react-start";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { chapter, cohort, cohortMember, cohortRelease, course, lesson, person } from "~/db/schema";
import { requireCourseTeacher, requireUser } from "~/server/auth/authz";
import { isPrivileged, loadPersonFacts } from "~/server/access/require";
import { now } from "~/lib/dates";

/** A cohort's read view for its members and the course's teachers. Null → 404. */
export const getCohort = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [row] = await db
      .select({ cohort, course: { id: course.id, slug: course.slug, title: course.title } })
      .from(cohort)
      .innerJoin(course, eq(course.id, cohort.courseId))
      .where(eq(cohort.slug, data.slug))
      .limit(1);
    if (!row) return null;
    const facts = await loadPersonFacts(user);
    const members = await db
      .select({ personId: cohortMember.personId, role: cohortMember.role, name: person.name })
      .from(cohortMember)
      .innerJoin(person, eq(person.id, cohortMember.personId))
      .where(eq(cohortMember.cohortId, row.cohort.id));
    const privileged = isPrivileged(facts, row.course.id);
    if (!privileged && !members.some((m) => m.personId === user.id)) return null;

    const releases = await db
      .select({
        id: cohortRelease.id,
        releaseAt: cohortRelease.releaseAt,
        chapterTitle: chapter.title,
        lessonTitle: lesson.title,
        lessonSlug: lesson.slug,
      })
      .from(cohortRelease)
      .leftJoin(chapter, eq(chapter.id, cohortRelease.chapterId))
      .leftJoin(lesson, eq(lesson.id, cohortRelease.lessonId))
      .where(eq(cohortRelease.cohortId, row.cohort.id))
      .orderBy(asc(cohortRelease.releaseAt));
    const at = now();
    return {
      cohort: row.cohort,
      course: row.course,
      privileged,
      memberCount: members.filter((m) => m.role === "student").length,
      teachers: members.filter((m) => m.role === "teacher").map((m) => m.name),
      releases: releases.map((r) => ({ ...r, released: r.releaseAt <= at })),
    };
  });

export const listCourseCohorts = createServerFn({ method: "GET" })
  .validator(z.object({ courseSlug: z.string() }))
  .handler(async ({ data }) => {
    const [c] = await db.select().from(course).where(eq(course.slug, data.courseSlug)).limit(1);
    if (!c) return null;
    await requireCourseTeacher(c.id);
    const rows = await db
      .select({
        id: cohort.id,
        slug: cohort.slug,
        title: cohort.title,
        status: cohort.status,
        startsAt: cohort.startsAt,
        endsAt: cohort.endsAt,
        students:
          sql<number>`(select count(*) from ${cohortMember} m where m.cohort_id = ${sql.raw('"cohort"."id"')} and m.role = 'student')`.mapWith(
            Number,
          ),
      })
      .from(cohort)
      .where(eq(cohort.courseId, c.id))
      .orderBy(desc(cohort.startsAt));
    return { course: { id: c.id, slug: c.slug }, cohorts: rows };
  });

/** Everything the teacher's cohort page edits: fields, members, schedule, and the course outline to schedule. */
export const getCohortEditor = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ cohort, course: { id: course.id, slug: course.slug, title: course.title } })
      .from(cohort)
      .innerJoin(course, eq(course.id, cohort.courseId))
      .where(eq(cohort.slug, data.slug))
      .limit(1);
    if (!row) return null;
    await requireCourseTeacher(row.course.id);
    const [members, releases, chapters, lessons] = await Promise.all([
      db
        .select({
          personId: person.id,
          name: person.name,
          email: person.email,
          role: cohortMember.role,
          joinedAt: cohortMember.joinedAt,
        })
        .from(cohortMember)
        .innerJoin(person, eq(person.id, cohortMember.personId))
        .where(eq(cohortMember.cohortId, row.cohort.id))
        .orderBy(asc(cohortMember.role), asc(person.name)),
      db
        .select({
          id: cohortRelease.id,
          chapterId: cohortRelease.chapterId,
          lessonId: cohortRelease.lessonId,
          releaseAt: cohortRelease.releaseAt,
          notifiedAt: cohortRelease.notifiedAt,
          chapterTitle: chapter.title,
          lessonTitle: lesson.title,
        })
        .from(cohortRelease)
        .leftJoin(chapter, eq(chapter.id, cohortRelease.chapterId))
        .leftJoin(lesson, eq(lesson.id, cohortRelease.lessonId))
        .where(eq(cohortRelease.cohortId, row.cohort.id))
        .orderBy(asc(cohortRelease.releaseAt)),
      db
        .select({ id: chapter.id, title: chapter.title })
        .from(chapter)
        .where(eq(chapter.courseId, row.course.id))
        .orderBy(asc(chapter.sort)),
      db
        .select({ id: lesson.id, title: lesson.title, chapterId: lesson.chapterId })
        .from(lesson)
        .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
        .where(eq(chapter.courseId, row.course.id))
        .orderBy(asc(chapter.sort), asc(lesson.sort)),
    ]);
    return { cohort: row.cohort, course: row.course, members, releases, chapters, lessons };
  });
