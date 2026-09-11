/**
 * Assignments and quizzes are reached through the lesson block that embeds them; access to the
 * thing is access to that lesson. Server-only.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { chapter, course, lesson, lessonBlock } from "~/db/schema";
import { AuthorizationError, type SessionUser } from "~/server/auth/authz";
import {
  isPrivileged,
  loadPersonFacts,
  requireLessonAccess,
  type PersonAccessFacts,
} from "./require";

export async function containingLesson(kind: "assignment" | "quiz", refId: string) {
  const key = kind === "assignment" ? "assignment_id" : "quiz_id";
  const rows = await db
    .select({ lesson, chapter, course })
    .from(lessonBlock)
    .innerJoin(lesson, eq(lesson.id, lessonBlock.lessonId))
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .innerJoin(course, eq(course.id, chapter.courseId))
    .where(and(eq(lessonBlock.type, kind), sql`${lessonBlock.payload}->>${key} = ${refId}`))
    .orderBy(chapter.sort, lesson.sort)
    .limit(1);
  return rows[0] ?? null;
}

export interface ContainerAccess {
  facts: PersonAccessFacts;
  privileged: boolean;
  lesson: { id: string; slug: string; title: string } | null;
}

/** Privileged people (course teachers, admins) always pass; students need the containing lesson open. */
export async function requireContainerAccess(
  user: SessionUser,
  kind: "assignment" | "quiz",
  refId: string,
  courseId: string,
): Promise<ContainerAccess> {
  const facts = await loadPersonFacts(user);
  const privileged = isPrivileged(facts, courseId);
  const container = await containingLesson(kind, refId);
  if (privileged)
    return {
      facts,
      privileged,
      lesson: container
        ? { id: container.lesson.id, slug: container.lesson.slug, title: container.lesson.title }
        : null,
    };
  if (!container) throw new AuthorizationError(403);
  await requireLessonAccess(user, container.lesson.id);
  return {
    facts,
    privileged,
    lesson: { id: container.lesson.id, slug: container.lesson.slug, title: container.lesson.title },
  };
}
