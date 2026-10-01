import { createFileRoute, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { listCourseCohorts } from "~/server/queries/cohorts";
import { EmailEnrollForm } from "~/components/enroll/EmailEnrollForm";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/enrollments")({
  loader: async ({ params }) => {
    const data = await listCourseCohorts({ data: { courseSlug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: EnrollmentsPage,
});

function EnrollmentsPage() {
  const { t } = useI18n();
  const { course, cohorts } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg">{t("enroll.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("enroll.lead")}</p>
      </div>
      <section className="rounded-lg border bg-card p-5">
        <EmailEnrollForm
          courseId={course.id}
          cohorts={cohorts.map((g) => ({ slug: g.slug, title: g.title }))}
          showFrom
        />
      </section>
    </div>
  );
}
