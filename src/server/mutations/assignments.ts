import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { db } from "~/db";
import {
  SUBMISSION_TYPES,
  assignment,
  chapter,
  course,
  courseTeacher,
  file,
  lesson,
  lessonProgress,
  submission,
} from "~/db/schema";
import { lmsConfig } from "~/config";
import { env } from "~/config/env";
import { markdownExcerpt } from "~/lib/markdown";
import { audit } from "~/server/audit";
import { requireCourseTeacher, requireUser } from "~/server/auth/authz";
import { requireContainerAccess } from "~/server/access/container";
import { headObject, signedPutUrl } from "~/server/services/files";
import { enqueue, sendImmediate } from "~/server/services/notifications";

const id = z.string().uuid();

// ---------- Authoring ----------

export const createAssignment = createServerFn({ method: "POST" })
  .validator(z.object({ courseId: id, title: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }) => {
    const user = await requireCourseTeacher(data.courseId);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(assignment)
        .values({ courseId: data.courseId, title: data.title })
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "assignment.create",
        entity: "assignment",
        entityId: row!.id,
        after: row,
      });
      return row!;
    });
  });

export const updateAssignment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      assignmentId: id,
      patch: z
        .object({
          title: z.string().trim().min(1).max(200),
          instructionsMd: z.string().max(50_000),
          submissionType: z.enum(SUBMISSION_TYPES),
          allowResubmit: z.boolean(),
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const [before] = await db
      .select()
      .from(assignment)
      .where(eq(assignment.id, data.assignmentId))
      .limit(1);
    if (!before) throw new Error("assignment not found");
    const user = await requireCourseTeacher(before.courseId);
    return db.transaction(async (tx) => {
      const [after] = await tx
        .update(assignment)
        .set(data.patch)
        .where(eq(assignment.id, before.id))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "assignment.update",
        entity: "assignment",
        entityId: before.id,
        before,
        after,
      });
      return after!;
    });
  });

export const deleteAssignment = createServerFn({ method: "POST" })
  .validator(z.object({ assignmentId: id }))
  .handler(async ({ data }) => {
    const [before] = await db
      .select()
      .from(assignment)
      .where(eq(assignment.id, data.assignmentId))
      .limit(1);
    if (!before) throw new Error("assignment not found");
    const user = await requireCourseTeacher(before.courseId);
    return db.transaction(async (tx) => {
      await tx.delete(assignment).where(eq(assignment.id, before.id));
      await audit(tx, {
        actorId: user.id,
        action: "assignment.delete",
        entity: "assignment",
        entityId: before.id,
        before,
      });
      return { ok: true };
    });
  });

// ---------- Student submissions ----------

async function loadAssignment(assignmentId: string) {
  const [row] = await db
    .select({ assignment, course })
    .from(assignment)
    .innerJoin(course, eq(course.id, assignment.courseId))
    .where(eq(assignment.id, assignmentId))
    .limit(1);
  if (!row) throw new Error("assignment not found");
  return row;
}

export const requestSubmissionUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      assignmentId: id,
      filename: z.string().min(1).max(255),
      mime: z.string().min(1),
      size: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await loadAssignment(data.assignmentId);
    await requireContainerAccess(user, "assignment", row.assignment.id, row.course.id);
    if (data.size > lmsConfig.uploads.maxBytes)
      throw new Error(
        `file too large (max ${Math.round(lmsConfig.uploads.maxBytes / 1_048_576)} MB)`,
      );
    if (!lmsConfig.uploads.allowedMime.includes(data.mime))
      throw new Error(`type not allowed: ${data.mime}`);
    const safeName = data.filename.replace(/[^\w.-]+/g, "_").slice(-120);
    const key = `submissions/${row.assignment.id}/${user.id}/${uuidv7()}-${safeName}`;
    return { key, url: await signedPutUrl(key, data.mime, data.size) };
  });

export const confirmSubmissionUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({ assignmentId: id, key: z.string().min(1), filename: z.string().min(1).max(255) }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!data.key.startsWith(`submissions/${data.assignmentId}/${user.id}/`))
      throw new Error("key outside your submission space");
    const head = await headObject(data.key);
    if (!head) throw new Error("object not found after upload");
    const [row] = await db
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
    const rec = row ?? (await db.select().from(file).where(eq(file.key, data.key)).limit(1))[0]!;
    return { id: rec.id, key: rec.key, filename: rec.filename, mime: rec.mime, size: rec.size };
  });

export const submitAssignment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      assignmentId: id,
      textMd: z.string().max(100_000).nullable(),
      fileKey: z.string().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await loadAssignment(data.assignmentId);
    const access = await requireContainerAccess(
      user,
      "assignment",
      row.assignment.id,
      row.course.id,
    );
    if (access.privileged) throw new Error("teachers do not submit");
    const type = row.assignment.submissionType;
    const text = data.textMd?.trim() || null;
    if ((type === "text" || type === "both") && !text && !data.fileKey)
      throw new Error("empty submission");
    if (type === "file" && !data.fileKey) throw new Error("a file is required");
    if (data.fileKey && !data.fileKey.startsWith(`submissions/${row.assignment.id}/${user.id}/`))
      throw new Error("file does not belong to this submission");

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(submission)
        .where(
          and(
            eq(submission.assignmentId, row.assignment.id),
            eq(submission.personId, user.id),
            isNull(submission.supersededBy),
          ),
        )
        .limit(1);
      if (current && !row.assignment.allowResubmit && current.status !== "returned")
        throw new Error("resubmission not allowed");
      const [created] = await tx
        .insert(submission)
        .values({
          assignmentId: row.assignment.id,
          personId: user.id,
          textMd: text,
          fileKey: data.fileKey,
        })
        .returning();
      if (current)
        await tx
          .update(submission)
          .set({ supersededBy: created!.id })
          .where(eq(submission.id, current.id));
      if (access.lesson) {
        const now = new Date();
        await tx
          .insert(lessonProgress)
          .values({
            personId: user.id,
            lessonId: access.lesson.id,
            status: "completed",
            completedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [lessonProgress.personId, lessonProgress.lessonId],
            set: { status: "completed", completedAt: now, updatedAt: now },
          });
      }
      await audit(tx, {
        actorId: user.id,
        action: "submission.create",
        entity: "submission",
        entityId: created!.id,
        after: { assignmentId: row.assignment.id, hasFile: !!data.fileKey },
      });
      const teachers = await tx
        .select({ personId: courseTeacher.personId })
        .from(courseTeacher)
        .where(eq(courseTeacher.courseId, row.course.id));
      for (const tch of teachers) {
        await enqueue(tx, tch.personId, "submission_received", {
          courseTitle: row.course.title,
          subject: row.assignment.title,
          detail: user.name,
          url: `${env.appUrl}/teach/courses/${row.course.slug}/submissions`,
        });
      }
      return { id: created!.id };
    });
  });

// ---------- Teacher review ----------

export const reviewSubmission = createServerFn({ method: "POST" })
  .validator(
    z.object({
      submissionId: id,
      status: z.enum(["reviewed", "returned"]),
      commentMd: z.string().max(50_000).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ submission, assignment, course })
      .from(submission)
      .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
      .innerJoin(course, eq(course.id, assignment.courseId))
      .where(eq(submission.id, data.submissionId))
      .limit(1);
    if (!row) throw new Error("submission not found");
    const user = await requireCourseTeacher(row.course.id);
    const result = await db.transaction(async (tx) => {
      const [after] = await tx
        .update(submission)
        .set({
          status: data.status,
          teacherCommentMd: data.commentMd,
          reviewedBy: user.id,
          reviewedAt: new Date(),
        })
        .where(eq(submission.id, row.submission.id))
        .returning();
      await audit(tx, {
        actorId: user.id,
        action: "submission.review",
        entity: "submission",
        entityId: row.submission.id,
        before: row.submission,
        after,
      });
      await enqueue(
        tx,
        row.submission.personId,
        "feedback_returned",
        {
          courseTitle: row.course.title,
          subject: row.assignment.title,
          detail: data.commentMd ? markdownExcerpt(data.commentMd, 300) : "",
          url: `${env.appUrl}/assignments/${row.assignment.id}`,
        },
        true,
      );
      return after!;
    });
    // Feedback is the one notification that goes out at once (docs/spec.md §7).
    sendImmediate().catch((e) => console.warn("immediate mail failed:", (e as Error).message));
    return result;
  });

export { chapter, lesson };
