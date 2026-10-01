import { createFileRoute, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { listCourseCohorts } from "~/server/queries/cohorts";
import { listCourseEnrollments } from "~/server/queries/enrollments";
import { Badge } from "~/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";
import { EmailEnrollForm } from "~/components/enroll/EmailEnrollForm";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/enrollments")({
  loader: async ({ params }) => {
    const [data, list] = await Promise.all([
      listCourseCohorts({ data: { courseSlug: params.courseSlug } }),
      listCourseEnrollments({ data: { courseSlug: params.courseSlug } }),
    ]);
    if (!data || !list) throw notFound();
    return { ...data, list };
  },
  component: EnrollmentsPage,
});

function EnrollmentsPage() {
  const { t, fmtDateTime } = useI18n();
  const { course, cohorts, list } = Route.useLoaderData();
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
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-lg">{t("enroll.list.title")}</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("enroll.list.lead")}</p>
        </div>
        {list.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("enroll.list.empty")}</p>
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>{t("enroll.list.person")}</Th>
                  <Th>{t("admin.person.cohort")}</Th>
                  <Th>{t("admin.person.source")}</Th>
                  <Th>{t("admin.person.status")}</Th>
                  <Th>{t("admin.person.from")}</Th>
                  <Th>{t("admin.person.until")}</Th>
                </tr>
              </THead>
              <TBody>
                {list.rows.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span>{e.name}</span>
                        <span className="text-xs text-muted-foreground">{e.email}</span>
                        {e.pending ? (
                          <span>
                            <Badge variant="outline">{t("enroll.list.pending")}</Badge>
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>{e.cohortTitle ?? "—"}</Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span>
                          <Badge variant={e.source === "manual" ? "info" : "outline"}>
                            {t(`source.${e.source}`)}
                          </Badge>
                        </span>
                        {e.externalId ? (
                          <span
                            className="font-mono text-xs text-muted-foreground"
                            title={t("admin.person.externalId")}
                          >
                            {e.externalId}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <Badge variant={e.status === "active" ? "success" : "outline"}>
                        {t(`enrollment.status.${e.status}`)}
                      </Badge>
                    </Td>
                    <Td>{e.validFrom ? fmtDateTime(e.validFrom) : "—"}</Td>
                    <Td>{e.validUntil ? fmtDateTime(e.validUntil) : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("enroll.list.synced")}</p>
            {list.total > list.rows.length ? (
              <p className="text-sm text-muted-foreground">
                {t("enroll.list.truncated", { n: list.rows.length, total: list.total })}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
