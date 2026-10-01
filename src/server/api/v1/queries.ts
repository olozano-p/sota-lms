/** Reads behind the service API. Plain functions: authentication happens in the dispatcher. */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { chapter, course, enrollment, lesson, lessonProgress, person } from "~/db/schema";
import { courseProgress } from "~/lib/progress";

export async function listCourses() {
  return db
    .select({
      slug: course.slug,
      externalRef: course.externalRef,
      title: course.title,
      status: course.status,
    })
    .from(course)
    .orderBy(asc(course.sort), asc(course.title));
}

/**
 * Progress of the person keyed by `sub`, per course: every course they hold an enrollment in (any
 * source or status) or have progress in. Null when no person has that sub.
 */
export async function userProgress(sub: string) {
  const [p] = await db
    .select({ id: person.id, sub: person.externalSub, email: person.email, name: person.name })
    .from(person)
    .where(eq(person.externalSub, sub))
    .limit(1);
  if (!p) return null;

  const enrolled = await db
    .select({ courseId: enrollment.courseId })
    .from(enrollment)
    .where(eq(enrollment.personId, p.id));
  const progress = await db
    .select({
      lessonId: lessonProgress.lessonId,
      status: lessonProgress.status,
      completedAt: lessonProgress.completedAt,
      updatedAt: lessonProgress.updatedAt,
      courseId: chapter.courseId,
    })
    .from(lessonProgress)
    .innerJoin(lesson, eq(lesson.id, lessonProgress.lessonId))
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .where(eq(lessonProgress.personId, p.id));
  const courseIds = [
    ...new Set([...enrolled.map((e) => e.courseId), ...progress.map((r) => r.courseId)]),
  ];
  if (!courseIds.length) return { user: { sub, email: p.email, name: p.name }, courses: [] };

  const [courses, lessons] = await Promise.all([
    db
      .select({
        id: course.id,
        slug: course.slug,
        externalRef: course.externalRef,
        title: course.title,
      })
      .from(course)
      .where(inArray(course.id, courseIds))
      .orderBy(asc(course.sort), asc(course.title)),
    db
      .select({ id: lesson.id, status: lesson.status, courseId: chapter.courseId })
      .from(lesson)
      .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
      .where(inArray(chapter.courseId, courseIds)),
  ]);
  const byLesson = new Map(progress.map((r) => [r.lessonId, r]));
  return {
    user: { sub, email: p.email, name: p.name },
    courses: courses.map((c) => {
      const mine = lessons.filter((l) => l.courseId === c.id);
      const rows = mine.map((l) => ({
        id: l.id,
        status: l.status,
        accessible: true,
        completed: byLesson.get(l.id)?.status === "completed",
      }));
      const summary = courseProgress(rows);
      const touched = mine.flatMap((l) => byLesson.get(l.id)?.updatedAt ?? []);
      const done = mine
        .filter((l) => l.status === "published")
        .flatMap((l) => (byLesson.get(l.id)?.status === "completed" ? [byLesson.get(l.id)!] : []));
      const all = summary.total > 0 && summary.completed === summary.total;
      const time = (d: Date) => d.getTime();
      return {
        slug: c.slug,
        externalRef: c.externalRef,
        title: c.title,
        lessonsTotal: summary.total,
        lessonsCompleted: summary.completed,
        ratio: summary.ratio,
        lastActivityAt: touched.length ? new Date(Math.max(...touched.map(time))) : null,
        completedAt:
          all && done.every((d) => d.completedAt)
            ? new Date(Math.max(...done.map((d) => time(d.completedAt!))))
            : null,
      };
    }),
  };
}
