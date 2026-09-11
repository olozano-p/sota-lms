/**
 * A person's own reading state. Written often (every ~10 s of playback), so — unlike every other
 * mutation — it is not audited; it carries no one else's data.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { lessonProgress } from "~/db/schema";
import { requireLessonAccess } from "~/server/access/require";
import { requireUser } from "~/server/auth/authz";

export const saveProgress = createServerFn({ method: "POST" })
  .validator(
    z.object({
      lessonId: z.string().uuid(),
      lastBlockSort: z.number().int().nullable().optional(),
      mediaPositionS: z.number().nonnegative().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireLessonAccess(user, data.lessonId);
    const set = {
      ...(data.lastBlockSort !== undefined ? { lastBlockSort: data.lastBlockSort } : {}),
      ...(data.mediaPositionS !== undefined ? { mediaPositionS: data.mediaPositionS } : {}),
      updatedAt: new Date(),
    };
    await db
      .insert(lessonProgress)
      .values({ personId: user.id, lessonId: data.lessonId, status: "started", ...set })
      .onConflictDoUpdate({ target: [lessonProgress.personId, lessonProgress.lessonId], set });
    return { ok: true };
  });

export const setLessonCompleted = createServerFn({ method: "POST" })
  .validator(z.object({ lessonId: z.string().uuid(), completed: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireLessonAccess(user, data.lessonId);
    const now = new Date();
    const set = data.completed
      ? { status: "completed" as const, completedAt: now, updatedAt: now }
      : { status: "started" as const, completedAt: null, updatedAt: now };
    await db
      .insert(lessonProgress)
      .values({ personId: user.id, lessonId: data.lessonId, ...set })
      .onConflictDoUpdate({ target: [lessonProgress.personId, lessonProgress.lessonId], set });
    return { status: set.status };
  });

export { and, eq };
