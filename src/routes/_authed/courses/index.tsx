import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useI18n } from "~/i18n";
import { listMyCourses } from "~/server/queries/courses";
import { buttonVariants } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty";
import { Eyebrow } from "~/components/ui/eyebrow";
import { lockMessage } from "~/components/LockNotice";
import { Slot } from "~/components/theme/Slot";
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
          {courses.map((c) => (
            <Slot
              key={c.id}
              name="CourseCard"
              course={{
                slug: c.slug,
                title: c.title,
                subtitle: c.subtitle,
                status: c.status,
                privileged: c.privileged,
                lockMessage: lockMessage(c.decision, i18n),
                progress: c.progress,
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
