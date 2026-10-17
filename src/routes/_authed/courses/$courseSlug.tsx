import { useState } from "react";
import {
  Outlet,
  createFileRoute,
  Link,
  notFound,
  useLocation,
  useParams,
} from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useI18n } from "~/i18n";
import { getCourseSyllabus } from "~/server/queries/courses";
import { Syllabus } from "~/components/syllabus/Syllabus";
import { cn } from "~/lib/cn";

/**
 * The course frame: the syllabus panel on the left (a disclosure above the content on phones) and
 * the course page, a lesson or the course forum on the right. Children read this loader's data for
 * the teachers and the chapter list.
 */
export const Route = createFileRoute("/_authed/courses/$courseSlug")({
  loader: async ({ params }) => {
    const data = await getCourseSyllabus({ data: { slug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CourseFrame,
});

function CourseFrame() {
  const { t } = useI18n();
  const { course, chapters, continueLesson, forumEnabled } = Route.useLoaderData();
  const { lessonSlug } = useParams({ strict: false });
  const onForum = useLocation({ select: (l) => l.pathname.includes(`/${course.slug}/forum`) });
  const [shown, setShown] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)] lg:pt-4 xl:gap-x-18">
      {/* Starts well below the page head, beside the lesson's opening media; the margin (not
          padding) leaves it when the panel sticks. */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:mt-64 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
        <Link
          to="/courses"
          className="label inline-flex h-8 items-center self-start rounded-sm bg-tint px-2 text-muted-foreground no-underline hover:text-foreground hover:no-underline"
        >
          ← {t("nav.courses")}
        </Link>
        <button
          type="button"
          aria-expanded={shown}
          aria-controls="course-syllabus"
          onClick={() => setShown((s) => !s)}
          className="label flex items-center justify-between rounded-lg bg-card p-4 lg:hidden"
        >
          {t("syllabus.title")}
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform", shown && "rotate-180")}
          />
        </button>
        {/* On phones, choosing a row closes the disclosure so the page opens at its content. */}
        <div
          id="course-syllabus"
          className={cn(!shown && "hidden", "lg:block")}
          onClick={(e) => (e.target as HTMLElement).closest("a") && setShown(false)}
        >
          <Syllabus
            courseSlug={course.slug}
            chapters={chapters}
            currentLessonSlug={lessonSlug}
            welcomeCurrent={!lessonSlug && !onForum}
            openChapterId={continueLesson?.chapterId}
            forumEnabled={forumEnabled}
          />
        </div>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
