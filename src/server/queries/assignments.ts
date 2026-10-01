import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { assignment, cohort, cohortMember, course, file, person, submission } from "~/db/schema";
import { renderMarkdown } from "~/lib/markdown";
import { AuthorizationError, requireCourseTeacher, requireUser } from "~/server/auth/authz";
import { requireContainerAccess } from "~/server/access/container";

async function fileUrls(keys: (string | null)[]) {
  const wanted = keys.filter((k): k is string => !!k);
  if (!wanted.length) return new Map<string, { url: string; filename: string }>();
  const rows = await db
    .select({ id: file.id, key: file.key, filename: file.filename })
    .from(file)
    .where(inArray(file.key, wanted));
  return new Map(rows.map((f) => [f.key, { url: `/api/files/${f.id}`, filename: f.filename }]));
}

/** The student's view of an assignment: instructions, their submissions, whether they may submit. */
export const getAssignment = createServerFn({ method: "GET" })
  .validator(z.object({ assignmentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [row] = await db
      .select({ assignment, course })
      .from(assignment)
      .innerJoin(course, eq(course.id, assignment.courseId))
      .where(eq(assignment.id, data.assignmentId))
      .limit(1);
    if (!row) return null;
    let access;
    try {
      access = await requireContainerAccess(user, "assignment", row.assignment.id, row.course.id);
    } catch (e) {
      if (e instanceof AuthorizationError) return null;
      throw e;
    }
    const mine = await db
      .select()
      .from(submission)
      .where(and(eq(submission.assignmentId, row.assignment.id), eq(submission.personId, user.id)))
      .orderBy(desc(submission.submittedAt));
    const files = await fileUrls(mine.map((s) => s.fileKey));
    const latest = mine.find((s) => s.supersededBy === null) ?? null;
    const canSubmit =
      !access.privileged &&
      (!latest || row.assignment.allowResubmit || latest.status === "returned");
    return {
      assignment: {
        id: row.assignment.id,
        title: row.assignment.title,
        instructionsHtml: renderMarkdown(row.assignment.instructionsMd),
        submissionType: row.assignment.submissionType,
        allowResubmit: row.assignment.allowResubmit,
      },
      course: { id: row.course.id, slug: row.course.slug, title: row.course.title },
      lesson: access.lesson,
      privileged: access.privileged,
      canSubmit,
      submissions: mine.map((s) => ({
        id: s.id,
        textHtml: s.textMd ? renderMarkdown(s.textMd) : null,
        file: s.fileKey ? (files.get(s.fileKey) ?? null) : null,
        submittedAt: s.submittedAt,
        status: s.status,
        teacherCommentHtml: s.teacherCommentMd ? renderMarkdown(s.teacherCommentMd) : null,
        reviewedAt: s.reviewedAt,
        superseded: s.supersededBy !== null,
      })),
    };
  });

/** Teacher list: the current (non-superseded) submission of every student, per assignment. */
export const listSubmissions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      courseSlug: z.string(),
      status: z.enum(["submitted", "reviewed", "returned"]).optional(),
      /** Only the students of this cohort (slug). */
      cohortSlug: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const [c] = await db.select().from(course).where(eq(course.slug, data.courseSlug)).limit(1);
    if (!c) return null;
    await requireCourseTeacher(c.id);
    const rows = await db
      .select({
        id: submission.id,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        personId: person.id,
        personName: person.name,
        personEmail: person.email,
        textMd: submission.textMd,
        fileKey: submission.fileKey,
        submittedAt: submission.submittedAt,
        status: submission.status,
        teacherCommentMd: submission.teacherCommentMd,
        reviewedAt: submission.reviewedAt,
      })
      .from(submission)
      .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
      .innerJoin(person, eq(person.id, submission.personId))
      .where(
        and(
          eq(assignment.courseId, c.id),
          isNull(submission.supersededBy),
          data.status ? eq(submission.status, data.status) : undefined,
          data.cohortSlug
            ? inArray(
                submission.personId,
                db
                  .select({ id: cohortMember.personId })
                  .from(cohortMember)
                  .innerJoin(cohort, eq(cohort.id, cohortMember.cohortId))
                  .where(
                    and(
                      eq(cohort.slug, data.cohortSlug),
                      eq(cohort.courseId, c.id),
                      eq(cohortMember.role, "student"),
                    ),
                  ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(submission.submittedAt));
    const files = await fileUrls(rows.map((r) => r.fileKey));
    return {
      course: { id: c.id, slug: c.slug, title: c.title },
      submissions: rows.map((r) => ({
        ...r,
        textHtml: r.textMd ? renderMarkdown(r.textMd) : null,
        file: r.fileKey ? (files.get(r.fileKey) ?? null) : null,
      })),
    };
  });

export const listCourseAssignments = createServerFn({ method: "GET" })
  .validator(z.object({ courseSlug: z.string() }))
  .handler(async ({ data }) => {
    const [c] = await db.select().from(course).where(eq(course.slug, data.courseSlug)).limit(1);
    if (!c) return null;
    await requireCourseTeacher(c.id);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.courseId, c.id))
      .orderBy(assignment.title);
    return { course: { id: c.id, slug: c.slug }, assignments: rows };
  });
