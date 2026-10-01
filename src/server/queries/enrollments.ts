import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { course } from "~/db/schema";
import { requireCourseTeacher } from "~/server/auth/authz";
import { courseEnrollmentRows } from "./course-enrollments-core";

/**
 * The enrollments of a course for its teachers: who, through which cohort, from which origin.
 * Synced rows (`claims`, `webhook`) are read-only there; only `manual` rows are managed in SOTA.
 */
export const listCourseEnrollments = createServerFn({ method: "GET" })
  .validator(z.object({ courseSlug: z.string() }))
  .handler(async ({ data }) => {
    const [c] = await db.select().from(course).where(eq(course.slug, data.courseSlug)).limit(1);
    if (!c) return null;
    await requireCourseTeacher(c.id);
    return courseEnrollmentRows(c.id);
  });
