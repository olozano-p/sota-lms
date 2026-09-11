import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { getCohort } from "~/server/queries/cohorts";
import { Badge } from "~/components/ui/badge";
import { Eyebrow } from "~/components/ui/eyebrow";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/cohorts/$cohortSlug")({
  loader: async ({ params }) => {
    const data = await getCohort({ data: { slug: params.cohortSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CohortPage,
});

function CohortPage() {
  const { t, fmtDate, fmtDateTime } = useI18n();
  const { cohort, course, memberCount, teachers, releases } = Route.useLoaderData();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link to="/courses/$courseSlug" params={{ courseSlug: course.slug }} className="text-sm">
          ← {course.title}
        </Link>
        <div className="flex items-center gap-2">
          <Eyebrow>{t("cohort.title")}</Eyebrow>
          <Badge variant={cohort.status === "active" ? "success" : "outline"}>
            {t(`cohort.status.${cohort.status}`)}
          </Badge>
        </div>
        <h1 className="text-4xl leading-tight">{cohort.title}</h1>
        <p className="text-muted-foreground">
          {cohort.startsAt && cohort.endsAt
            ? t("cohort.dates", { start: fmtDate(cohort.startsAt), end: fmtDate(cohort.endsAt) })
            : cohort.startsAt
              ? t("cohort.from", { start: fmtDate(cohort.startsAt) })
              : null}
        </p>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <Eyebrow>{t("cohort.course")}</Eyebrow>
            <dd className="mt-1">
              <Link to="/courses/$courseSlug" params={{ courseSlug: course.slug }}>
                {course.title}
              </Link>
            </dd>
          </div>
          <div>
            <Eyebrow>{t("cohort.teachers")}</Eyebrow>
            <dd className="mt-1">{teachers.length ? teachers.join(", ") : "—"}</dd>
          </div>
          <div>
            <Eyebrow>{t("cohort.members", { n: memberCount })}</Eyebrow>
            <dd className="mt-1 tabular-nums">{memberCount}</dd>
          </div>
        </dl>
      </header>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">{t("cohort.schedule")}</h2>
          <p className="text-sm text-muted-foreground">{t("cohort.schedule.lead")}</p>
        </div>
        <ol className="relative ml-2 flex flex-col border-l">
          {releases.map((r) => (
            <li key={r.id} className="relative flex items-start gap-4 py-2 pl-5">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-[5px] top-3.5 size-2.5 rounded-full border bg-background",
                  r.released ? "border-primary bg-primary" : "border-muted-foreground/60",
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">
                  {r.lessonTitle ? (
                    <Link
                      to="/courses/$courseSlug/$lessonSlug"
                      params={{ courseSlug: course.slug, lessonSlug: r.lessonSlug! }}
                    >
                      {r.lessonTitle}
                    </Link>
                  ) : (
                    r.chapterTitle
                  )}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {fmtDateTime(r.releaseAt)}
                </span>
              </div>
              <Badge variant={r.released ? "success" : "outline"}>
                {r.released ? t("cohort.released") : t("cohort.upcoming")}
              </Badge>
            </li>
          ))}
        </ol>
      </section>
      <div>
        <Link
          to="/courses/$courseSlug"
          params={{ courseSlug: course.slug }}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "text-foreground no-underline hover:no-underline",
          )}
        >
          {t("cohort.goToCourse")}
        </Link>
      </div>
    </div>
  );
}
