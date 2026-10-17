import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import {
  chapter,
  cohort,
  cohortMember,
  course,
  courseTeacher,
  lesson,
  lessonProgress,
  person,
} from "~/db/schema";
import { renderMarkdown } from "~/lib/markdown";
import {
  chapterPosition,
  chapterRelease,
  continueTarget,
  courseProgress,
  courseState,
} from "~/lib/progress";
import { requireUser } from "~/server/auth/authz";
import {
  decideCourse,
  decideLessons,
  enrolledCourses,
  isPrivileged,
  loadPersonFacts,
} from "~/server/access/require";
import type { Decision } from "~/server/access/rules";
import { coverUrls } from "./covers";

async function lessonsOf(courseIds: string[]) {
  if (!courseIds.length) return [];
  return db
    .select({
      id: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      status: lesson.status,
      estimatedMinutes: lesson.estimatedMinutes,
      sort: lesson.sort,
      chapterId: chapter.id,
      chapterSort: chapter.sort,
      chapterTitle: chapter.title,
      chapterSlug: chapter.slug,
      courseId: chapter.courseId,
    })
    .from(lesson)
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .where(inArray(chapter.courseId, courseIds))
    .orderBy(asc(chapter.sort), asc(lesson.sort));
}

/** My courses: enrolled (or taught) courses with cover, computed progress and where each one stands. */
export const listMyCourses = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const facts = await loadPersonFacts(user);
  const all = await db
    .select()
    .from(course)
    .where(inArray(course.status, ["published", "archived"]))
    .orderBy(asc(course.sort), asc(course.title));
  const drafts =
    facts.admin || facts.teacherOf.size
      ? await db.select().from(course).where(eq(course.status, "draft"))
      : [];
  const visible = [
    ...enrolledCourses(facts, all),
    ...drafts.filter((c) => isPrivileged(facts, c.id)),
  ];
  const lessons = await lessonsOf(visible.map((c) => c.id));
  const progressRows = lessons.length
    ? await db
        .select()
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.personId, user.id),
            inArray(
              lessonProgress.lessonId,
              lessons.map((l) => l.id),
            ),
          ),
        )
    : [];
  const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
  const covers = await coverUrls(visible.map((c) => c.coverImageKey));

  const courses = visible.map((c) => {
    const mine = lessons.filter((l) => l.courseId === c.id);
    const decisions = decideLessons(facts, c, mine);
    const rows = mine.map((l) => ({
      ...l,
      accessible: decisions.get(l.id)?.ok ?? false,
      completed: progressByLesson.get(l.id)?.status === "completed",
    }));
    const next = continueTarget(rows);
    const lastActivity =
      rows
        .map((l) => progressByLesson.get(l.id)?.updatedAt ?? null)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const decision = decideCourse(facts, c);
    const progress = courseProgress(rows);
    const published = rows.filter((l) => l.status === "published");
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      coverUrl: c.coverImageKey ? (covers.get(c.coverImageKey) ?? null) : null,
      language: c.language,
      status: c.status,
      privileged: isPrivileged(facts, c.id),
      decision,
      progress,
      state: courseState(progress, decision, lastActivity !== null),
      position: next
        ? chapterPosition(
            published.map((l) => l.chapterId),
            next.chapterId,
          )
        : null,
      continueLesson: next
        ? { slug: next.slug, title: next.title, chapterTitle: next.chapterTitle }
        : null,
      lastActivityAt: lastActivity,
    };
  });

  // Most recently touched first, so the course in hand is the first card.
  courses.sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0));
  return { courses };
});

export type SyllabusLesson = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  estimatedMinutes: number | null;
  status: "draft" | "published";
  decision: Decision;
  progress: "none" | "started" | "completed";
};

/**
 * Everything the course frame needs: the syllabus beside every course page, the welcome view and
 * the lesson meta (teachers). Null when the person is not enrolled (→ 404).
 */
export const getCourseSyllabus = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [c] = await db.select().from(course).where(eq(course.slug, data.slug)).limit(1);
    if (!c) return null;
    const facts = await loadPersonFacts(user);
    const privileged = isPrivileged(facts, c.id);
    if (!privileged && enrolledCourses(facts, [c]).length === 0) return null;

    const [chapters, lessons, progressRows, cohorts, teachers] = await Promise.all([
      db.select().from(chapter).where(eq(chapter.courseId, c.id)).orderBy(asc(chapter.sort)),
      lessonsOf([c.id]),
      db.select().from(lessonProgress).where(eq(lessonProgress.personId, user.id)),
      db
        .select({ slug: cohort.slug, title: cohort.title })
        .from(cohortMember)
        .innerJoin(cohort, eq(cohort.id, cohortMember.cohortId))
        .where(and(eq(cohortMember.personId, user.id), eq(cohort.courseId, c.id))),
      db
        .select({ name: person.name })
        .from(courseTeacher)
        .innerJoin(person, eq(person.id, courseTeacher.personId))
        .where(eq(courseTeacher.courseId, c.id))
        .orderBy(asc(person.name)),
    ]);
    const decisions = decideLessons(facts, c, lessons);
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
    const visibleLessons = lessons.filter((l) => privileged || l.status === "published");
    const rows = visibleLessons.map((l) => ({
      ...l,
      accessible: decisions.get(l.id)?.ok ?? false,
      completed: progressByLesson.get(l.id)?.status === "completed",
    }));
    const next = continueTarget(rows);
    const decision = decideCourse(facts, c);

    return {
      course: {
        id: c.id,
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle,
        descriptionHtml: renderMarkdown(c.descriptionMd),
        language: c.language,
        status: c.status,
        endedAt: c.endedAt,
      },
      privileged,
      decision,
      // The forum shows only to people the forum gate would let in.
      forumEnabled: c.forumEnabled && (privileged || decision.ok),
      teachers: teachers.map((p) => p.name),
      chapters: chapters
        .map((ch) => ({
          id: ch.id,
          slug: ch.slug,
          title: ch.title,
          descriptionHtml: ch.descriptionMd ? renderMarkdown(ch.descriptionMd) : "",
          lessons: visibleLessons
            .filter((l) => l.chapterId === ch.id)
            .map((l): SyllabusLesson => ({
              id: l.id,
              slug: l.slug,
              title: l.title,
              summary: l.summary,
              estimatedMinutes: l.estimatedMinutes,
              status: l.status,
              decision: decisions.get(l.id)!,
              progress:
                (progressByLesson.get(l.id)?.status as "started" | "completed" | undefined) ??
                "none",
            })),
        }))
        .map((ch) => ({
          ...ch,
          locked: ch.lessons.length > 0 && ch.lessons.every((l) => !l.decision.ok),
          availableAt: chapterRelease(ch.lessons.map((l) => l.decision)),
        }))
        .filter((ch) => privileged || ch.lessons.length > 0),
      minutes: visibleLessons.reduce((n, l) => n + (l.estimatedMinutes ?? 0), 0),
      progress: courseProgress(rows),
      continueLesson: next
        ? { slug: next.slug, title: next.title, chapterId: next.chapterId }
        : null,
      cohorts,
    };
  });

export { desc };
