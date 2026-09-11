import { Outlet, createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useI18n } from "~/i18n";
import { getCourseEditor } from "~/server/queries/teach";
import { Badge } from "~/components/ui/badge";
import { Tab, Tabs } from "~/components/ui/tabs";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";

/** Course editor layout: title, status, tabs. Children load their own data. */
export const Route = createFileRoute("/_authed/teach/courses/$courseSlug")({
  loader: async ({ params }) => {
    const data = await getCourseEditor({ data: { slug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CourseEditorLayout,
});

function CourseEditorLayout() {
  const { t } = useI18n();
  const { course } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link to="/teach" className="text-sm">
          ← {t("teach.title")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Badge
              variant={
                course.status === "published"
                  ? "success"
                  : course.status === "archived"
                    ? "outline"
                    : "warning"
              }
              className="self-start"
            >
              {t(`teach.status.${course.status}`)}
            </Badge>
            <h1 className="text-3xl">{course.title}</h1>
          </div>
          <Link
            to="/courses/$courseSlug"
            params={{ courseSlug: course.slug }}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "text-foreground no-underline hover:no-underline",
            )}
          >
            <Eye aria-hidden="true" />
            {t("teach.view")}
          </Link>
        </div>
      </div>
      <Tabs label={course.title}>
        <Tab
          to="/teach/courses/$courseSlug"
          params={{ courseSlug: course.slug }}
          activeOptions={{ exact: true }}
        >
          {t("teach.tabs.structure")}
        </Tab>
        <Tab to="/teach/courses/$courseSlug/assignments" params={{ courseSlug: course.slug }}>
          {t("teach.tabs.assignments")}
        </Tab>
        <Tab to="/teach/courses/$courseSlug/quizzes" params={{ courseSlug: course.slug }}>
          {t("teach.tabs.quizzes")}
        </Tab>
        <Tab to="/teach/courses/$courseSlug/submissions" params={{ courseSlug: course.slug }}>
          {t("teach.tabs.submissions")}
        </Tab>
        <Tab to="/teach/courses/$courseSlug/cohorts" params={{ courseSlug: course.slug }}>
          {t("teach.tabs.cohorts")}
        </Tab>
        <Tab to="/teach/courses/$courseSlug/settings" params={{ courseSlug: course.slug }}>
          {t("teach.tabs.settings")}
        </Tab>
      </Tabs>
      <Outlet />
    </div>
  );
}
