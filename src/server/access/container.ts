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

/**
 * Lessons of `courseId` that embed the assignment or quiz, in syllabus order. Blocks in other
 * courses never count: a course must not become a door into another course's assignments.
 */
export async function containingLessons(
  kind: "assignment" | "quiz",
  refId: string,
  courseId: string,
) {
  const key = kind === "assignment" ? "assignment_id" : "quiz_id";
  return db
    .select({ lesson, chapter, course })
    .from(lessonBlock)
    .innerJoin(lesson, eq(lesson.id, lessonBlock.lessonId))
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .innerJoin(course, eq(course.id, chapter.courseId))
    .where(
      and(
        eq(lessonBlock.type, kind),
        eq(chapter.courseId, courseId),
        sql`${lessonBlock.payload}->>${key} = ${refId}`,
      ),
    )
    .orderBy(chapter.sort, lesson.sort);
}

export interface ContainerAccess {
  facts: PersonAccessFacts;
  privileged: boolean;
  lesson: { id: string; slug: string; title: string } | null;
}

/** Privileged people (course teachers, admins) always pass; students need one containing lesson open. */
export async function requireContainerAccess(
  user: SessionUser,
  kind: "assignment" | "quiz",
  refId: string,
  courseId: string,
): Promise<ContainerAccess> {
  const facts = await loadPersonFacts(user);
  const privileged = isPrivileged(facts, courseId);
  const containers = await containingLessons(kind, refId, courseId);
  const summary = (c: (typeof containers)[number]) => ({
    id: c.lesson.id,
    slug: c.lesson.slug,
    title: c.lesson.title,
  });
  if (privileged)
    return { facts, privileged, lesson: containers[0] ? summary(containers[0]) : null };
  for (const c of containers) {
    try {
      await requireLessonAccess(user, c.lesson.id);
      return { facts, privileged, lesson: summary(c) };
    } catch (e) {
      if (!(e instanceof AuthorizationError)) throw e;
    }
  }
  throw new AuthorizationError(403);
}
