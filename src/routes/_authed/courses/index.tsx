import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { listMyCourses } from "~/server/queries/courses";
import { Empty } from "~/components/ui/empty";
import { PageHeader } from "~/components/ui/page-header";
import { lockMessage } from "~/components/LockNotice";
import { Slot } from "~/components/theme/Slot";

export const Route = createFileRoute("/_authed/courses/")({
  loader: () => listMyCourses(),
  component: CoursesPage,
});

function CoursesPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const { courses } = Route.useLoaderData();
  const sections = [
    {
      key: "active",
      title: t("courses.section.active"),
      rows: courses.filter((c) => c.state !== "finished"),
    },
    {
      key: "finished",
      title: t("courses.section.finished"),
      rows: courses.filter((c) => c.state === "finished"),
    },
  ].filter((s) => s.rows.length);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-16">
      <PageHeader title={t("courses.title")} />
      {courses.length === 0 ? (
        <Empty title={t("courses.empty.title")}>{t("courses.empty.lead")}</Empty>
      ) : (
        sections.map((s) => (
          <section key={s.key} aria-labelledby={`courses-${s.key}`} className="flex flex-col gap-6">
            <h2
              id={`courses-${s.key}`}
              className="font-serif text-sm leading-[1.2] font-medium tracking-normal"
            >
              {s.title}
            </h2>
            <ul className="flex flex-col gap-6">
              {s.rows.map((c) => (
                <Slot
                  key={c.id}
                  name="CourseCard"
                  course={{
                    slug: c.slug,
                    title: c.title,
                    subtitle: c.subtitle,
                    coverUrl: c.coverUrl,
                    status: c.status,
                    state: c.state,
                    position: c.position,
                    privileged: c.privileged,
                    lockMessage: lockMessage(c.decision, i18n),
                    progress: c.progress,
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
