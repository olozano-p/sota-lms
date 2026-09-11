import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { useI18n } from "~/i18n";
import { listCourseCohorts } from "~/server/queries/cohorts";
import { createCohort } from "~/server/mutations/cohorts";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/cohorts")({
  loader: async ({ params }) => {
    const data = await listCourseCohorts({ data: { courseSlug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CohortsPage,
});

function CohortsPage() {
  const { t, fmtDate } = useI18n();
  const { course, cohorts } = Route.useLoaderData();
  const router = useRouter();
  const create = useServerFn(createCohort);
  const [form, setForm] = useState({ title: "", startsAt: "", endsAt: "" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("teach.cohorts.lead")}</p>
      {cohorts.length === 0 ? <Empty title={t("common.empty")} /> : null}
      <ul className="flex flex-col gap-2">
        {cohorts.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <Badge variant={c.status === "active" ? "success" : "outline"}>
              {t(`cohort.status.${c.status}`)}
            </Badge>
            <Link
              to="/teach/cohorts/$cohortSlug"
              params={{ cohortSlug: c.slug }}
              className="min-w-0 flex-1 truncate font-medium text-foreground"
            >
              {c.title}
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums">
              {c.startsAt ? fmtDate(c.startsAt) : "—"} → {c.endsAt ? fmtDate(c.endsAt) : "—"}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("teach.cohorts.students", { n: c.students })}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.title.trim()) return;
          setBusy(true);
          try {
            const c = await create({
              data: {
                courseId: course.id,
                title: form.title.trim(),
                startsAt: form.startsAt || null,
                endsAt: form.endsAt || null,
              },
            });
            await router.navigate({
              to: "/teach/cohorts/$cohortSlug",
              params: { cohortSlug: c.slug },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("teach.cohorts.title")}>
          {(c) => (
            <Input
              {...c}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("teach.cohorts.starts")}>
          {(c) => (
            <Input
              {...c}
              type="date"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("teach.cohorts.ends")}>
          {(c) => (
            <Input
              {...c}
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" loading={busy}>
          <Plus aria-hidden="true" />
          {t("teach.cohorts.new")}
        </Button>
      </form>
    </div>
  );
}
