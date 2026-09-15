import { Outlet, createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { getCourseHeader } from "~/server/queries/forum";
import { Badge } from "~/components/ui/badge";
import { Tab, Tabs } from "~/components/ui/tabs";

/**
 * Course layout: title and, when the course has a forum, the Syllabus · Forum tabs. The lesson
 * player lives under `$courseSlug_/` so it keeps its URL but not this frame.
 */
export const Route = createFileRoute("/_authed/courses/$courseSlug")({
  loader: async ({ params }) => {
    const data = await getCourseHeader({ data: { slug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CourseLayout,
});

function CourseLayout() {
  const { t } = useI18n();
  const { course, privileged, forumEnabled } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link to="/courses" className="text-sm">
          ← {t("nav.courses")}
        </Link>
        {course.status !== "published" || privileged ? (
          <div className="flex flex-wrap items-center gap-2">
            {course.status === "draft" ? (
              <Badge variant="warning">{t("courses.draft")}</Badge>
            ) : null}
            {course.status === "archived" ? <Badge>{t("courses.archived")}</Badge> : null}
            {privileged ? <Badge variant="info">{t("courses.teaching")}</Badge> : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl leading-tight">{course.title}</h1>
          {course.subtitle ? (
            <p className="text-lg text-muted-foreground">{course.subtitle}</p>
          ) : null}
        </div>
      </header>
      {forumEnabled ? (
        <Tabs label={course.title}>
          <Tab
            to="/courses/$courseSlug"
            params={{ courseSlug: course.slug }}
            activeOptions={{ exact: true }}
          >
            {t("courses.tabs.syllabus")}
          </Tab>
          <Tab to="/courses/$courseSlug/forum" params={{ courseSlug: course.slug }}>
            {t("courses.tabs.forum")}
          </Tab>
        </Tabs>
      ) : null}
      <Outlet />
    </div>
  );
}
