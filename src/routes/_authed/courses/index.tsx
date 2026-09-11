import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useI18n } from "~/i18n";
import { listMyCourses } from "~/server/queries/courses";
import { buttonVariants } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Empty } from "~/components/ui/empty";
import { Eyebrow } from "~/components/ui/eyebrow";
import { ProgressRule } from "~/components/ui/progress-rule";
import { lockMessage } from "~/components/LockNotice";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/courses/")({
  loader: () => listMyCourses(),
  component: CoursesPage,
});

function CoursesPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const { courses, resume } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl">{t("courses.title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("courses.lead")}</p>
      </div>

      {resume ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-5">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t("courses.resume.eyebrow")}</Eyebrow>
            <p className="font-serif text-xl">{resume.lessonTitle}</p>
            <p className="text-sm text-muted-foreground">{resume.courseTitle}</p>
          </div>
          <Link
            to="/courses/$courseSlug/$lessonSlug"
            params={{ courseSlug: resume.courseSlug, lessonSlug: resume.lessonSlug }}
            className={cn(
              buttonVariants({ size: "lg" }),
              "text-primary-foreground no-underline hover:no-underline",
            )}
          >
            {t("courses.resume.cta")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      {courses.length === 0 ? (
        <Empty title={t("courses.empty.title")}>{t("courses.empty.lead")}</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {courses.map((c) => {
            const lock = lockMessage(c.decision, i18n);
            return (
              <li
                key={c.id}
                className="flex flex-col justify-between gap-4 rounded-lg border bg-card p-5"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.status === "draft" ? (
                      <Badge variant="warning">{t("courses.draft")}</Badge>
                    ) : null}
                    {c.status === "archived" ? <Badge>{t("courses.archived")}</Badge> : null}
                    {c.privileged ? <Badge variant="info">{t("courses.teaching")}</Badge> : null}
                  </div>
                  <h2 className="font-serif text-xl font-medium tracking-normal">
                    <Link
                      to="/courses/$courseSlug"
                      params={{ courseSlug: c.slug }}
                      className="text-foreground"
                    >
                      {c.title}
                    </Link>
                  </h2>
                  {c.subtitle ? (
                    <p className="text-sm text-muted-foreground">{c.subtitle}</p>
                  ) : null}
                  {lock ? <p className="text-sm text-muted-foreground">{lock}</p> : null}
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>
                      {t("courses.progress", {
                        completed: c.progress.completed,
                        total: c.progress.total,
                      })}
                    </span>
                    <span>{t("common.percent", { n: Math.round(c.progress.ratio * 100) })}</span>
                  </div>
                  <ProgressRule value={c.progress.ratio} label={t("courses.progress.label")} />
                  <div>
                    <Link
                      to="/courses/$courseSlug"
                      params={{ courseSlug: c.slug }}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "text-foreground no-underline hover:no-underline",
                      )}
                    >
                      {t("courses.open")}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
