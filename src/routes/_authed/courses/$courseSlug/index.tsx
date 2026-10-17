import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useI18n } from "~/i18n";
import { Markdown } from "~/components/player/Markdown";
import { LockNotice } from "~/components/LockNotice";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { ProgressRule } from "~/components/ui/progress-rule";
import { cn } from "~/lib/cn";

const frame = getRouteApi("/_authed/courses/$courseSlug");

export const Route = createFileRoute("/_authed/courses/$courseSlug/")({
  component: CoursePage,
});

/** The course's welcome: its description (a video line is a player), who teaches, and where to go next. */
function CoursePage() {
  const { t, fmtDuration } = useI18n();
  const {
    course,
    privileged,
    chapters,
    progress,
    continueLesson,
    cohorts,
    decision,
    teachers,
    minutes,
  } = frame.useLoaderData();
  const total = chapters.reduce((n, ch) => n + ch.lessons.length, 0);
  const allDone = progress.total > 0 && progress.completed === progress.total;
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        crumbs={[{ label: t("nav.courses"), link: { to: "/courses" } }, { label: course.title }]}
        title={course.title}
        meta={
          <>
            {course.status === "draft" ? (
              <Badge variant="warning">{t("courses.draft")}</Badge>
            ) : null}
            {course.status === "archived" ? (
              <Badge variant="secondary">{t("courses.archived")}</Badge>
            ) : null}
            {privileged ? <Badge variant="info">{t("courses.teaching")}</Badge> : null}
            {teachers.map((name) => (
              <Badge key={name}>{name}</Badge>
            ))}
            <Badge className="tabular-nums">{t("syllabus.lessons", { n: total })}</Badge>
            {minutes ? <Badge className="tabular-nums">{fmtDuration(minutes * 60)}</Badge> : null}
            {cohorts.map((c) => (
              <Link
                key={c.slug}
                to="/cohorts/$cohortSlug"
                params={{ cohortSlug: c.slug }}
                className={buttonVariants({ variant: "link" })}
              >
                {t("syllabus.cohort", { title: c.title })}
              </Link>
            ))}
          </>
        }
      />
      {course.subtitle || course.descriptionHtml ? (
        <div className="flex flex-col gap-4">
          {course.subtitle ? (
            <p className="max-w-measure font-serif text-[0.9375rem] leading-[1.4] text-foreground/80">
              {course.subtitle}
            </p>
          ) : null}
          {course.descriptionHtml ? <Markdown html={course.descriptionHtml} /> : null}
        </div>
      ) : null}
      <section aria-label={t("courses.progress.label")} className="flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="label text-muted-foreground tabular-nums">
            {t("courses.progress", { completed: progress.completed, total: progress.total })}
          </p>
          <ProgressRule value={progress.ratio} label={t("courses.progress.label")} />
        </div>
        {allDone ? (
          <p className="font-serif text-sm text-foreground/80">{t("syllabus.completed.all")}</p>
        ) : null}
        {continueLesson ? (
          <Link
            to="/courses/$courseSlug/$lessonSlug"
            params={{ courseSlug: course.slug, lessonSlug: continueLesson.slug }}
            className={cn(buttonVariants(), "self-start no-underline hover:no-underline")}
            title={continueLesson.title}
          >
            <Play aria-hidden="true" />
            {progress.completed === 0 ? t("syllabus.start") : t("syllabus.continue")}
          </Link>
        ) : (
          <LockNotice decision={decision} />
        )}
      </section>
    </div>
  );
}
