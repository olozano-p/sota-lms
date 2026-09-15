import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { course, courseTeacher, forumPost, forumReaction, forumThread, person } from "~/db/schema";
import { lmsConfig } from "~/config";
import { markdownExcerpt, renderMarkdown } from "~/lib/markdown";
import { AuthorizationError, requireUser, type SessionUser } from "~/server/auth/authz";
import {
  loadForumCourse,
  loadThreadScope,
  requireForumAccess,
  type ForumAccess,
  type ForumCourse,
} from "~/server/access/forum";
import {
  decideCourse,
  entitledCourses,
  isPrivileged,
  loadPersonFacts,
} from "~/server/access/require";

export type AuthorRole = "admin" | "teacher" | null;

export interface ForumScope {
  kind: "course" | "general";
  course: { id: string; slug: string; title: string } | null;
}

const scopeOf = (c: ForumCourse | null): ForumScope =>
  c
    ? { kind: "course", course: { id: c.id, slug: c.slug, title: c.title } }
    : { kind: "general", course: null };

async function accessOrNull(user: SessionUser, c: ForumCourse | null): Promise<ForumAccess | null> {
  try {
    return await requireForumAccess(user, c);
  } catch (e) {
    if (e instanceof AuthorizationError) return null;
    throw e;
  }
}

/** Names and forum roles for a set of authors; teachers of *this* course, admins anywhere. */
async function authorsOf(ids: string[], c: ForumCourse | null) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, { id: string; name: string; role: AuthorRole }>();
  const [people, teaching] = await Promise.all([
    db
      .select({ id: person.id, name: person.name, roles: person.roles })
      .from(person)
      .where(inArray(person.id, unique)),
    c
      ? db
          .select({ personId: courseTeacher.personId })
          .from(courseTeacher)
          .where(eq(courseTeacher.courseId, c.id))
      : Promise.resolve([] as { personId: string }[]),
  ]);
  const teachers = new Set(teaching.map((t) => t.personId));
  return new Map(
    people.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        role: p.roles.includes("admin")
          ? ("admin" as const)
          : (c ? teachers.has(p.id) : p.roles.includes("teacher"))
            ? ("teacher" as const)
            : null,
      },
    ]),
  );
}

const unknownAuthor = (id: string | null) => ({ id, name: "", role: null as AuthorRole });

/** Threads of one forum, pinned first then latest activity. Null when the forum is not reachable. */
export const listThreads = createServerFn({ method: "GET" })
  .validator(
    z.object({
      courseSlug: z.string().nullable(),
      page: z.number().int().min(1).default(1),
      q: z.string().trim().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const c = data.courseSlug ? await loadForumCourse(data.courseSlug) : null;
    if (data.courseSlug && !c) return null;
    const access = await accessOrNull(user, c);
    if (!access) return null;

    const pageSize = lmsConfig.forum.pageSize;
    const where = and(
      c ? eq(forumThread.courseId, c.id) : isNull(forumThread.courseId),
      data.q ? ilike(forumThread.title, `%${data.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
    );
    const stats = db
      .select({
        threadId: forumPost.threadId,
        replies: sql<number>`count(*) filter (where ${forumPost.deletedAt} is null) - 1`
          .mapWith(Number)
          .as("replies"),
        lastPostAt: sql<Date>`max(${forumPost.createdAt})`.as("last_post_at"),
      })
      .from(forumPost)
      .innerJoin(forumThread, eq(forumThread.id, forumPost.threadId))
      .where(where)
      .groupBy(forumPost.threadId)
      .as("stats");
    const lastActivity = sql`coalesce(${stats.lastPostAt}, ${forumThread.createdAt})`;

    const [[counted], rows] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(forumThread)
        .where(where),
      db
        .select({
          id: forumThread.id,
          title: forumThread.title,
          authorPersonId: forumThread.authorPersonId,
          pinnedAt: forumThread.pinnedAt,
          lockedAt: forumThread.lockedAt,
          createdAt: forumThread.createdAt,
          replies: stats.replies,
          lastActivityAt: lastActivity.mapWith((v) => new Date(v as string)),
        })
        .from(forumThread)
        .leftJoin(stats, eq(stats.threadId, forumThread.id))
        .where(where)
        .orderBy(
          sql`${forumThread.pinnedAt} is null`,
          desc(forumThread.pinnedAt),
          desc(lastActivity),
        )
        .limit(pageSize)
        .offset((data.page - 1) * pageSize),
    ]);

    const ids = rows.map((r) => r.id);
    // One row per thread each way: the opening post (for the excerpt) and the latest (its author).
    const edge = (order: "asc" | "desc") =>
      ids.length
        ? db
            .selectDistinctOn([forumPost.threadId], {
              threadId: forumPost.threadId,
              authorPersonId: forumPost.authorPersonId,
              bodyMd: forumPost.bodyMd,
              deletedAt: forumPost.deletedAt,
            })
            .from(forumPost)
            .where(inArray(forumPost.threadId, ids))
            .orderBy(
              forumPost.threadId,
              order === "asc" ? asc(forumPost.createdAt) : desc(forumPost.createdAt),
            )
        : Promise.resolve([]);
    const [first, last] = await Promise.all([edge("asc"), edge("desc")]);
    const opening = new Map(first.map((p) => [p.threadId, p]));
    const latest = new Map(last.map((p) => [p.threadId, p]));
    const posts = [...first, ...last];
    const authors = await authorsOf(
      [...rows.map((r) => r.authorPersonId), ...posts.map((p) => p.authorPersonId)].filter(
        (x): x is string => !!x,
      ),
      c,
    );
    const author = (id: string | null) => (id && authors.get(id)) || unknownAuthor(id);

    return {
      scope: scopeOf(c),
      moderator: access.moderator,
      threads: rows.map((r) => ({
        id: r.id,
        title: r.title,
        pinned: r.pinnedAt !== null,
        locked: r.lockedAt !== null,
        author: author(r.authorPersonId),
        createdAt: r.createdAt,
        replies: r.replies ?? 0,
        lastActivityAt: r.lastActivityAt,
        lastAuthor: author(latest.get(r.id)?.authorPersonId ?? null),
        excerpt: (() => {
          const o = opening.get(r.id);
          return o && !o.deletedAt ? markdownExcerpt(o.bodyMd, 180) : "";
        })(),
      })),
      page: data.page,
      pageCount: Math.max(1, Math.ceil((counted?.n ?? 0) / pageSize)),
      total: counted?.n ?? 0,
    };
  });

/** One thread with every post, rendered. Null when missing or not reachable. */
export const getThread = createServerFn({ method: "GET" })
  .validator(z.object({ threadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const scope = await loadThreadScope(data.threadId);
    if (!scope) return null;
    const access = await accessOrNull(user, scope.course);
    if (!access) return null;
    const { thread } = scope;

    const posts = await db
      .select()
      .from(forumPost)
      .where(eq(forumPost.threadId, thread.id))
      .orderBy(asc(forumPost.createdAt));
    const postIds = posts.map((p) => p.id);
    const [counts, mine, authors] = await Promise.all([
      postIds.length
        ? db
            .select({
              postId: forumReaction.postId,
              likes: sql<number>`count(*) filter (where ${forumReaction.value} = 'like')`.mapWith(
                Number,
              ),
              dislikes:
                sql<number>`count(*) filter (where ${forumReaction.value} = 'dislike')`.mapWith(
                  Number,
                ),
            })
            .from(forumReaction)
            .where(inArray(forumReaction.postId, postIds))
            .groupBy(forumReaction.postId)
        : [],
      postIds.length
        ? db
            .select({ postId: forumReaction.postId, value: forumReaction.value })
            .from(forumReaction)
            .where(and(inArray(forumReaction.postId, postIds), eq(forumReaction.personId, user.id)))
        : [],
      authorsOf(
        [thread.authorPersonId, ...posts.map((p) => p.authorPersonId)].filter(
          (x): x is string => !!x,
        ),
        scope.course,
      ),
    ]);
    const countBy = new Map(counts.map((r) => [r.postId, r]));
    const mineBy = new Map(mine.map((r) => [r.postId, r.value]));
    const byId = new Map(posts.map((p) => [p.id, p]));
    const author = (id: string | null) => (id && authors.get(id)) || unknownAuthor(id);
    const openingId = posts[0]?.id ?? null;

    return {
      scope: scopeOf(scope.course),
      moderator: access.moderator,
      thread: {
        id: thread.id,
        title: thread.title,
        author: author(thread.authorPersonId),
        createdAt: thread.createdAt,
        pinned: thread.pinnedAt !== null,
        locked: thread.lockedAt !== null,
        canRename: access.moderator || thread.authorPersonId === user.id,
      },
      canReply: thread.lockedAt === null || access.moderator,
      me: user.id,
      posts: posts.map((p) => {
        const own = p.authorPersonId === user.id;
        const deleted = p.deletedAt !== null;
        const replyTo = p.replyToPostId ? byId.get(p.replyToPostId) : undefined;
        return {
          id: p.id,
          author: author(p.authorPersonId),
          createdAt: p.createdAt,
          editedAt: p.editedAt,
          deleted,
          html: deleted ? "" : renderMarkdown(p.bodyMd),
          md: deleted ? "" : p.bodyMd,
          replyTo: replyTo
            ? { id: replyTo.id, authorName: author(replyTo.authorPersonId).name }
            : null,
          likes: countBy.get(p.id)?.likes ?? 0,
          dislikes: countBy.get(p.id)?.dislikes ?? 0,
          myReaction: mineBy.get(p.id) ?? null,
          isOpening: p.id === openingId,
          canEdit: !deleted && (own || access.moderator),
          canDelete: !deleted && p.id !== openingId && (own || access.moderator),
          canReact: !deleted && !own,
        };
      }),
    };
  });

/** What the course layout needs above its tabs. Null when the person may not see the course. */
export const getCourseHeader = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [c] = await db.select().from(course).where(eq(course.slug, data.slug)).limit(1);
    if (!c) return null;
    const facts = await loadPersonFacts(user);
    const privileged = isPrivileged(facts, c.id);
    if (!privileged && entitledCourses(facts, [c]).length === 0) return null;
    return {
      course: { id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, status: c.status },
      privileged,
      // The tab shows only to people the forum gate would let in.
      forumEnabled: c.forumEnabled && (privileged || decideCourse(facts, c).ok),
    };
  });
