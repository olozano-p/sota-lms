/**
 * Who may read and write in a forum. A course forum follows the course: the person must be able
 * to open the course right now (or teach it); the general forum needs a session and the config
 * switch. Moderators are the course's teachers and admins; in the general forum, anyone with the
 * teacher role. Server-only.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { course, forumThread } from "~/db/schema";
import { lmsConfig } from "~/config";
import { AuthorizationError, hasRole, type SessionUser } from "~/server/auth/authz";
import {
  decideCourse,
  isPrivileged,
  loadPersonFacts,
  type PersonAccessFacts,
} from "~/server/access/require";
import type { ForumFileScope } from "~/lib/forum";

export type ForumCourse = Pick<
  typeof course.$inferSelect,
  "id" | "slug" | "title" | "status" | "endedAt" | "forumEnabled"
>;

export interface ForumAccess {
  facts: PersonAccessFacts;
  /** May pin, lock, edit and delete anything in this forum. */
  moderator: boolean;
  course: ForumCourse | null;
}

const courseColumns = {
  id: course.id,
  slug: course.slug,
  title: course.title,
  status: course.status,
  endedAt: course.endedAt,
  forumEnabled: course.forumEnabled,
};

export async function loadForumCourse(slug: string): Promise<ForumCourse | null> {
  const [c] = await db.select(courseColumns).from(course).where(eq(course.slug, slug)).limit(1);
  return c ?? null;
}

export async function loadForumCourseById(id: string): Promise<ForumCourse | null> {
  const [c] = await db.select(courseColumns).from(course).where(eq(course.id, id)).limit(1);
  return c ?? null;
}

/** Throws 403 unless the person may read this forum; `null` is the general forum. */
export async function requireForumAccess(
  user: SessionUser,
  forumCourse: ForumCourse | null,
): Promise<ForumAccess> {
  const facts = await loadPersonFacts(user);
  if (!forumCourse) {
    if (!lmsConfig.forum.general) throw new AuthorizationError(403);
    return { facts, moderator: facts.admin || hasRole(user, "teacher"), course: null };
  }
  if (!forumCourse.forumEnabled) throw new AuthorizationError(403);
  const privileged = isPrivileged(facts, forumCourse.id);
  if (!privileged && !decideCourse(facts, forumCourse).ok) throw new AuthorizationError(403);
  return { facts, moderator: privileged, course: forumCourse };
}

/** Same check for a stored file, from the scope encoded in its key. */
export async function requireForumFileAccess(
  user: SessionUser,
  scope: ForumFileScope,
): Promise<ForumAccess> {
  if (scope.kind === "general") return requireForumAccess(user, null);
  const c = await loadForumCourseById(scope.courseId);
  if (!c) throw new AuthorizationError(403);
  return requireForumAccess(user, c);
}

/** A thread with the course it belongs to (null for the general forum), or null when missing. */
export async function loadThreadScope(threadId: string) {
  const [thread] = await db.select().from(forumThread).where(eq(forumThread.id, threadId)).limit(1);
  if (!thread) return null;
  const c = thread.courseId ? await loadForumCourseById(thread.courseId) : null;
  if (thread.courseId && !c) return null;
  return { thread, course: c };
}
