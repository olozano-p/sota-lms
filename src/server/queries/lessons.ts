import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { chapter, course, lesson, lessonBlock, lessonProgress } from "~/db/schema";
import { requireUser } from "~/server/auth/authz";
import {
  decideLessons,
  entitledCourses,
  isPrivileged,
  loadPersonFacts,
} from "~/server/access/require";
import { isMediaOnly, resolveBlocks, type ResolvedBlock } from "~/server/services/blocks";

/**
 * The lesson page. A locked lesson still returns its title, position and neighbours (the reader
 * sees why and when), but no blocks. Not entitled to the course at all → null → 404.
 */
export const getLesson = createServerFn({ method: "GET" })
  .validator(z.object({ courseSlug: z.string(), lessonSlug: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [c] = await db.select().from(course).where(eq(course.slug, data.courseSlug)).limit(1);
    if (!c) return null;
    const facts = await loadPersonFacts(user);
    const privileged = isPrivileged(facts, c.id);
    if (!privileged && entitledCourses(facts, [c]).length === 0) return null;

    const ordered = await db
      .select({
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        summary: lesson.summary,
        status: lesson.status,
        estimatedMinutes: lesson.estimatedMinutes,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterSlug: chapter.slug,
      })
      .from(lesson)
      .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
      .where(eq(chapter.courseId, c.id))
      .orderBy(asc(chapter.sort), asc(lesson.sort));
    const visible = ordered.filter((l) => privileged || l.status === "published");
    const index = visible.findIndex((l) => l.slug === data.lessonSlug);
    if (index === -1) return null;
    const current = visible[index]!;
    const decisions = decideLessons(facts, c, visible);
    const decision = decisions.get(current.id)!;

    const [blockRows, progressRows] = await Promise.all([
      decision.ok
        ? db
            .select()
            .from(lessonBlock)
            .where(eq(lessonBlock.lessonId, current.id))
            .orderBy(asc(lessonBlock.sort))
        : [],
      db
        .select()
        .from(lessonProgress)
        .where(and(eq(lessonProgress.personId, user.id), eq(lessonProgress.lessonId, current.id)))
        .limit(1),
    ]);
    const blocks: ResolvedBlock[] | null = decision.ok ? await resolveBlocks(blockRows) : null;
    const prev = visible[index - 1];
    const next = visible[index + 1];
    const progress = progressRows[0];

    return {
      course: { id: c.id, slug: c.slug, title: c.title },
      chapter: { slug: current.chapterSlug, title: current.chapterTitle },
      lesson: {
        id: current.id,
        slug: current.slug,
        title: current.title,
        summary: current.summary,
        estimatedMinutes: current.estimatedMinutes,
        status: current.status,
      },
      decision,
      privileged,
      blocks,
      mediaOnly: decision.ok ? isMediaOnly(blockRows) : false,
      progress: progress
        ? {
            status: progress.status,
            lastBlockSort: progress.lastBlockSort,
            mediaPositionS: progress.mediaPositionS,
          }
        : null,
      prev: prev ? { slug: prev.slug, title: prev.title } : null,
      next: next
        ? { slug: next.slug, title: next.title, locked: !(decisions.get(next.id)?.ok ?? false) }
        : null,
      position: { index: index + 1, total: visible.length },
    };
  });
