/**
 * Forum writes: threads, posts, reactions, moderation and post images. Every function starts with
 * the forum access gate and appends an audit row inside its transaction (CLAUDE.md invariants).
 */
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { db } from "~/db";
import { FORUM_REACTIONS, file, forumPost, forumReaction, forumThread } from "~/db/schema";
import { lmsConfig } from "~/config";
import { forumFileKey, forumScopeFromFileKey, nextReaction } from "~/lib/forum";
import { audit } from "~/server/audit";
import { AuthorizationError, requireUser, type SessionUser } from "~/server/auth/authz";
import {
  loadForumCourse,
  loadThreadScope,
  requireForumAccess,
  requireForumFileAccess,
  type ForumAccess,
} from "~/server/access/forum";
import { headObject, signedPutUrl } from "~/server/services/files";

const id = z.string().uuid();
const title = z.string().trim().min(3).max(200);
const bodyMd = z.string().trim().min(1).max(100_000);

/** Loads the thread, resolves its forum and applies the gate; 403 when either fails. */
async function threadAccess(user: SessionUser, threadId: string) {
  const scope = await loadThreadScope(threadId);
  if (!scope) throw new AuthorizationError(403);
  const access = await requireForumAccess(user, scope.course);
  return { ...scope, access };
}

async function postAccess(user: SessionUser, postId: string) {
  const [post] = await db.select().from(forumPost).where(eq(forumPost.id, postId)).limit(1);
  if (!post) throw new AuthorizationError(403);
  const rest = await threadAccess(user, post.threadId);
  const [opening] = await db
    .select({ id: forumPost.id })
    .from(forumPost)
    .where(eq(forumPost.threadId, post.threadId))
    .orderBy(asc(forumPost.createdAt))
    .limit(1);
  return { post, isOpening: opening?.id === post.id, ...rest };
}

const mayEdit = (access: ForumAccess, authorId: string | null, user: SessionUser) =>
  access.moderator || authorId === user.id;

// ---------- Threads ----------

export const createThread = createServerFn({ method: "POST" })
  .validator(z.object({ courseSlug: z.string().nullable(), title, bodyMd }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const c = data.courseSlug ? await loadForumCourse(data.courseSlug) : null;
    if (data.courseSlug && !c) throw new AuthorizationError(403);
    await requireForumAccess(user, c);
    return db.transaction(async (tx) => {
      const [thread] = await tx
        .insert(forumThread)
        .values({ courseId: c?.id ?? null, authorPersonId: user.id, title: data.title })
        .returning();
      const [post] = await tx
        .insert(forumPost)
        .values({ threadId: thread!.id, authorPersonId: user.id, bodyMd: data.bodyMd })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "thread.create",
        entity: "forum_thread",
        entityId: thread!.id,
        after: { courseId: c?.id ?? null, title: data.title, openingPostId: post!.id },
      });
      return { id: thread!.id };
    });
  });

export const updateThread = createServerFn({ method: "POST" })
  .validator(
    z.object({
      threadId: id,
      patch: z.object({ title, pinned: z.boolean(), locked: z.boolean() }).partial(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { thread, access } = await threadAccess(user, data.threadId);
    const { title: newTitle, pinned, locked } = data.patch;
    if (newTitle !== undefined && !mayEdit(access, thread.authorPersonId, user))
      throw new AuthorizationError(403);
    if ((pinned !== undefined || locked !== undefined) && !access.moderator)
      throw new AuthorizationError(403);
    return db.transaction(async (tx) => {
      const [after] = await tx
        .update(forumThread)
        .set({
          ...(newTitle !== undefined ? { title: newTitle } : {}),
          ...(pinned !== undefined ? { pinnedAt: pinned ? new Date() : null } : {}),
          ...(locked !== undefined ? { lockedAt: locked ? new Date() : null } : {}),
        })
        .where(eq(forumThread.id, thread.id))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "thread.update",
        entity: "forum_thread",
        entityId: thread.id,
        before: { title: thread.title, pinnedAt: thread.pinnedAt, lockedAt: thread.lockedAt },
        after: { title: after!.title, pinnedAt: after!.pinnedAt, lockedAt: after!.lockedAt },
      });
      return { ok: true as const };
    });
  });

export const deleteThread = createServerFn({ method: "POST" })
  .validator(z.object({ threadId: id }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { thread, access } = await threadAccess(user, data.threadId);
    if (!access.moderator) throw new AuthorizationError(403);
    return db.transaction(async (tx) => {
      await tx.delete(forumThread).where(eq(forumThread.id, thread.id));
      await audit(tx, {
        actorId: user.id,
        action: "thread.delete",
        entity: "forum_thread",
        entityId: thread.id,
        before: thread,
      });
      return { ok: true as const };
    });
  });

// ---------- Posts ----------

export const replyToThread = createServerFn({ method: "POST" })
  .validator(z.object({ threadId: id, bodyMd, replyToPostId: id.nullable().optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { thread, access } = await threadAccess(user, data.threadId);
    if (thread.lockedAt && !access.moderator) throw new Error("thread is locked");
    if (data.replyToPostId) {
      const [cited] = await db
        .select({ id: forumPost.id, deletedAt: forumPost.deletedAt })
        .from(forumPost)
        .where(and(eq(forumPost.id, data.replyToPostId), eq(forumPost.threadId, thread.id)))
        .limit(1);
      if (!cited || cited.deletedAt) throw new Error("cited post not found");
    }
    return db.transaction(async (tx) => {
      const [post] = await tx
        .insert(forumPost)
        .values({
          threadId: thread.id,
          authorPersonId: user.id,
          bodyMd: data.bodyMd,
          replyToPostId: data.replyToPostId ?? null,
        })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "post.create",
        entity: "forum_post",
        entityId: post!.id,
        after: { threadId: thread.id, replyToPostId: data.replyToPostId ?? null },
      });
      return { id: post!.id };
    });
  });

export const updatePost = createServerFn({ method: "POST" })
  .validator(z.object({ postId: id, bodyMd }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { post, access } = await postAccess(user, data.postId);
    if (post.deletedAt || !mayEdit(access, post.authorPersonId, user))
      throw new AuthorizationError(403);
    return db.transaction(async (tx) => {
      await tx
        .update(forumPost)
        .set({ bodyMd: data.bodyMd, editedAt: new Date() })
        .where(eq(forumPost.id, post.id));
      await audit(tx, {
        actorId: user.id,
        action: "post.update",
        entity: "forum_post",
        entityId: post.id,
        before: { bodyMd: post.bodyMd },
        after: { bodyMd: data.bodyMd },
      });
      return { ok: true as const };
    });
  });

/** Soft delete: the slot stays so replies that cite it keep their context. */
export const deletePost = createServerFn({ method: "POST" })
  .validator(z.object({ postId: id }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { post, access, isOpening } = await postAccess(user, data.postId);
    if (post.deletedAt || !mayEdit(access, post.authorPersonId, user))
      throw new AuthorizationError(403);
    if (isOpening) throw new Error("the opening post goes with its thread");
    return db.transaction(async (tx) => {
      await tx
        .update(forumPost)
        .set({ bodyMd: "", deletedAt: new Date() })
        .where(eq(forumPost.id, post.id));
      await audit(tx, {
        actorId: user.id,
        action: "post.delete",
        entity: "forum_post",
        entityId: post.id,
        before: { bodyMd: post.bodyMd, authorPersonId: post.authorPersonId },
      });
      return { ok: true as const };
    });
  });

export const reactToPost = createServerFn({ method: "POST" })
  .validator(z.object({ postId: id, value: z.enum(FORUM_REACTIONS).nullable() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { post } = await postAccess(user, data.postId);
    if (post.deletedAt) throw new Error("post deleted");
    if (post.authorPersonId === user.id) throw new Error("no reacting to your own post");
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ value: forumReaction.value })
        .from(forumReaction)
        .where(and(eq(forumReaction.postId, post.id), eq(forumReaction.personId, user.id)))
        .limit(1);
      const next = nextReaction(current?.value ?? null, data.value);
      if (next === null) {
        await tx
          .delete(forumReaction)
          .where(and(eq(forumReaction.postId, post.id), eq(forumReaction.personId, user.id)));
      } else {
        await tx
          .insert(forumReaction)
          .values({ postId: post.id, personId: user.id, value: next })
          .onConflictDoUpdate({
            target: [forumReaction.postId, forumReaction.personId],
            set: { value: next, createdAt: new Date() },
          });
      }
      await audit(tx, {
        actorId: user.id,
        action: "post.react",
        entity: "forum_post",
        entityId: post.id,
        before: { value: current?.value ?? null },
        after: { value: next },
      });
      const [counts] = await tx
        .select({
          likes: sql<number>`count(*) filter (where ${forumReaction.value} = 'like')`.mapWith(
            Number,
          ),
          dislikes: sql<number>`count(*) filter (where ${forumReaction.value} = 'dislike')`.mapWith(
            Number,
          ),
        })
        .from(forumReaction)
        .where(eq(forumReaction.postId, post.id));
      return { myReaction: next, likes: counts?.likes ?? 0, dislikes: counts?.dislikes ?? 0 };
    });
  });

// ---------- Images in posts ----------

const isImage = (mime: string) =>
  mime.startsWith("image/") && lmsConfig.uploads.allowedMime.includes(mime);

export const requestForumUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      courseSlug: z.string().nullable(),
      filename: z.string().min(1).max(255),
      mime: z.string().min(1),
      size: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const c = data.courseSlug ? await loadForumCourse(data.courseSlug) : null;
    if (data.courseSlug && !c) throw new AuthorizationError(403);
    await requireForumAccess(user, c);
    if (!isImage(data.mime)) throw new Error(`type not allowed: ${data.mime}`);
    if (data.size > lmsConfig.forum.imageMaxBytes)
      throw new Error(
        `image too large (max ${Math.round(lmsConfig.forum.imageMaxBytes / 1_048_576)} MB)`,
      );
    const key = forumFileKey(
      c ? { kind: "course", courseId: c.id } : { kind: "general" },
      uuidv7(),
      data.filename,
    );
    return { key, url: await signedPutUrl(key, data.mime, data.size) };
  });

export const confirmForumUpload = createServerFn({ method: "POST" })
  .validator(z.object({ key: z.string().min(1), filename: z.string().min(1).max(255) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const scope = forumScopeFromFileKey(data.key);
    if (!scope) throw new Error("key outside the forum");
    await requireForumFileAccess(user, scope);
    const head = await headObject(data.key);
    if (!head) throw new Error("object not found after upload");
    if (!isImage(head.mime)) throw new Error(`type not allowed: ${head.mime}`);
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
