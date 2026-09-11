import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { chapter, cohort, cohortMember, cohortRelease, course, lesson, person } from "~/db/schema";
import { requireUser } from "~/server/auth/authz";
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
