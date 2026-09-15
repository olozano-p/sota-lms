import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Users } from "lucide-react";
import { useI18n } from "~/i18n";
import { getCourseSyllabus } from "~/server/queries/courses";
import { Syllabus } from "~/components/syllabus/Syllabus";
import { Markdown } from "~/components/player/Markdown";
import { LockNotice } from "~/components/LockNotice";
import { buttonVariants } from "~/components/ui/button";
import { ProgressRule } from "~/components/ui/progress-rule";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/courses/$courseSlug/")({
  loader: async ({ params }) => {
    const data = await getCourseSyllabus({ data: { slug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CoursePage,
});

function CoursePage() {
  const { t } = useI18n();
  const { course, chapters, progress, continueLesson, cohorts, decision } = Route.useLoaderData();
  const total = chapters.reduce((n, ch) => n + ch.lessons.length, 0);
  const allDone = progress.total > 0 && progress.completed === progress.total;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="tabular-nums">{t("syllabus.lessons", { n: total })}</span>
          {cohorts.map((c) => (
            <Link
              key={c.slug}
              to="/cohorts/$cohortSlug"
              params={{ cohortSlug: c.slug }}
              className="inline-flex items-center gap-1.5"
            >
              <Users className="size-4" aria-hidden="true" />
              {t("syllabus.cohort", { title: c.title })}
            </Link>
          ))}
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6 lg:order-2">
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
              <span>
                {t("courses.progress", { completed: progress.completed, total: progress.total })}
              </span>
              <span>{t("common.percent", { n: Math.round(progress.ratio * 100) })}</span>
            </div>
            <ProgressRule value={progress.ratio} label={t("courses.progress.label")} />
            {allDone ? (
              <p className="text-sm text-muted-foreground">{t("syllabus.completed.all")}</p>
            ) : null}
            {continueLesson ? (
              <Link
                to="/courses/$courseSlug/$lessonSlug"
                params={{ courseSlug: course.slug, lessonSlug: continueLesson.slug }}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "justify-between text-primary-foreground no-underline hover:no-underline",
                )}
              >
                <span className="truncate">
                  {progress.completed === 0 ? t("syllabus.start") : t("syllabus.continue")}
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
            ) : (
              <LockNotice decision={decision} />
            )}
            {continueLesson ? (
              <p className="truncate text-xs text-muted-foreground">{continueLesson.title}</p>
            ) : null}
          </div>
          {course.descriptionHtml ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-base">{t("syllabus.about")}</h2>
              <Markdown html={course.descriptionHtml} className="prose text-[0.95rem]" />
            </section>
          ) : null}
        </aside>
        <div className="lg:order-1">
          <Syllabus courseSlug={course.slug} chapters={chapters} />
        </div>
      </div>
    </div>
  );
}
