/** Reads behind the service API. Plain functions: authentication happens in the dispatcher. */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import {
  chapter,
  course,
  enrollment,
  lesson,
  lessonBlock,
  lessonProgress,
  person,
} from "~/db/schema";
import { env } from "~/config/env";
import { courseProgress, nextLesson } from "~/lib/progress";
import { decideLessons, readPersonFacts } from "~/server/access/require";
import { mapRoles } from "~/server/auth/roles";

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

export type LessonKind = "video" | "audio" | "quiz" | "text";

/** What a lesson mostly is, for the caller's icon: video, else audio, else quiz, else text. */
function lessonKind(types: string[]): LessonKind {
  return (["video", "audio", "quiz"] as const).find((k) => types.includes(k)) ?? "text";
}

/** Absolute links into the app; signed-out visitors are sent through sign-in and back. */
const courseUrl = (slug: string) => `${env.appUrl}/courses/${encodeURIComponent(slug)}`;
const lessonUrl = (courseSlug: string, lessonSlug: string) =>
  `${courseUrl(courseSlug)}/${encodeURIComponent(lessonSlug)}`;

/**
 * Progress of the person keyed by `sub`, per course: every course they hold an enrollment in (any
 * source or status) or have progress in, with the next lesson open to them now. Null when no
 * person has that sub.
 */
export async function userProgress(sub: string) {
  const [p] = await db
    .select({
      id: person.id,
      sub: person.externalSub,
      email: person.email,
      name: person.name,
      roles: person.roles,
    })
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

  const [courses, lessons, facts] = await Promise.all([
    db
      .select({
        id: course.id,
        slug: course.slug,
        externalRef: course.externalRef,
        title: course.title,
        status: course.status,
      })
      .from(course)
      .where(inArray(course.id, courseIds))
      .orderBy(asc(course.sort), asc(course.title)),
    db
      .select({
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        status: lesson.status,
        estimatedMinutes: lesson.estimatedMinutes,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        courseId: chapter.courseId,
      })
      .from(lesson)
      .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
      .where(inArray(chapter.courseId, courseIds))
      .orderBy(asc(chapter.sort), asc(lesson.sort)),
    readPersonFacts({ id: p.id, roles: mapRoles(p.roles) }),
  ]);
  const byLesson = new Map(progress.map((r) => [r.lessonId, r]));
  const summaries = courses.map((c) => {
    const mine = lessons.filter((l) => l.courseId === c.id);
    const decisions = decideLessons(facts, c, mine);
    const rows = mine.map((l) => ({
      ...l,
      accessible: decisions.get(l.id)?.ok ?? false,
      completed: byLesson.get(l.id)?.status === "completed",
    }));
    const published = rows.filter((l) => l.status === "published");
    return { c, mine, rows, published, next: nextLesson(rows) };
  });

  const nextIds = summaries.flatMap((s) => (s.next ? [s.next.id] : []));
  const blocks = nextIds.length
    ? await db
        .select({
          lessonId: lessonBlock.lessonId,
          type: lessonBlock.type,
          payload: lessonBlock.payload,
        })
        .from(lessonBlock)
        .where(inArray(lessonBlock.lessonId, nextIds))
        .orderBy(asc(lessonBlock.sort))
    : [];

  return {
    user: { sub, email: p.email, name: p.name },
    courses: summaries.map(({ c, mine, rows, published, next }) => {
      const summary = courseProgress(rows);
      const touched = mine.flatMap((l) => byLesson.get(l.id)?.updatedAt ?? []);
      const done = published.flatMap((l) =>
        byLesson.get(l.id)?.status === "completed" ? [byLesson.get(l.id)!] : [],
      );
      const all = summary.total > 0 && summary.completed === summary.total;
      const time = (d: Date) => d.getTime();
      return {
        slug: c.slug,
        externalRef: c.externalRef,
        title: c.title,
        url: courseUrl(c.slug),
        lessonsTotal: summary.total,
        lessonsCompleted: summary.completed,
        ratio: summary.ratio,
        lastActivityAt: touched.length ? new Date(Math.max(...touched.map(time))) : null,
        completedAt:
          all && done.every((d) => d.completedAt)
            ? new Date(Math.max(...done.map((d) => time(d.completedAt!))))
            : null,
        nextLesson: next
          ? { ...describeLesson(next, c.slug, published, blocks), started: byLesson.has(next.id) }
          : null,
      };
    }),
  };
}

/** The next lesson as the caller shows it: where it sits, how long it takes and what it holds. */
function describeLesson(
  l: {
    id: string;
    slug: string;
    title: string;
    chapterTitle: string;
    estimatedMinutes: number | null;
  },
  courseSlug: string,
  published: { id: string }[],
  blocks: { lessonId: string; type: string; payload: Record<string, unknown> }[],
) {
  const own = blocks.filter((b) => b.lessonId === l.id);
  const media = own
    .filter((b) => b.type === "video" || b.type === "audio")
    .map((b) => (typeof b.payload.duration_s === "number" ? b.payload.duration_s : null));
  const thumbnail = own.find((b) => b.type === "video")?.payload.thumbnail_url;
  return {
    slug: l.slug,
    position: published.findIndex((x) => x.id === l.id) + 1,
    title: l.title,
    sectionTitle: l.chapterTitle,
    // The teacher's estimate wins (0 is none, as in the app); without one, the length of the
    // lesson's media, unknown when any of it has no known length.
    durationSeconds: l.estimatedMinutes
      ? l.estimatedMinutes * 60
      : media.length && media.every((d) => d !== null)
        ? Math.round(media.reduce<number>((a, b) => a + b!, 0))
        : null,
    kind: lessonKind(own.map((b) => b.type)),
    thumbnailUrl: typeof thumbnail === "string" ? thumbnail : null,
    url: lessonUrl(courseSlug, l.slug),
  };
}
