import { useState } from "react";
import { createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Download } from "lucide-react";
import { useI18n } from "~/i18n";
import { listSubmissions } from "~/server/queries/assignments";
import { reviewSubmission } from "~/server/mutations/assignments";
import { Markdown } from "~/components/player/Markdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty";
import { Field } from "~/components/ui/field";
import { Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/submissions")({
  validateSearch: z.object({ status: z.enum(["submitted", "reviewed", "returned"]).optional() }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ params, deps }) => {
    const data = await listSubmissions({
      data: { courseSlug: params.courseSlug, status: deps.status },
    });
    if (!data) throw notFound();
    return data;
  },
  component: SubmissionsPage,
});

function SubmissionsPage() {
  const { t, fmtDateTime } = useI18n();
  const { submissions } = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("teach.submissions.lead")}</p>
        <Field label={t("teach.submissions.filter")}>
          {(c) => (
            <Select
              {...c}
              value={status ?? ""}
              onChange={(e) =>
                navigate({ search: { status: (e.target.value || undefined) as typeof status } })
              }
              className="w-48"
            >
              <option value="">{t("teach.submissions.all")}</option>
              {(["submitted", "reviewed", "returned"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`assignment.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {submissions.length === 0 ? <Empty title={t("teach.submissions.empty")} /> : null}
      <ul className="flex flex-col gap-4">
        {submissions.map((s) => (
          <li key={s.id} className="flex flex-col gap-4 rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{s.personName}</p>
                <p className="text-xs text-muted-foreground">
                  {s.personEmail} · {s.assignmentTitle}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="tabular-nums">{fmtDateTime(s.submittedAt)}</span>
                <Badge
                  variant={
                    s.status === "returned"
                      ? "warning"
                      : s.status === "reviewed"
                        ? "success"
                        : "info"
                  }
                >
                  {t(`assignment.status.${s.status}`)}
                </Badge>
              </div>
            </div>
            {s.textHtml ? <Markdown html={s.textHtml} className="prose text-[0.95rem]" /> : null}
            {s.file ? (
              <a href={s.file.url} className="inline-flex items-center gap-2 text-sm">
                <Download className="size-4" aria-hidden="true" />
                {s.file.filename}
              </a>
            ) : null}
            <ReviewForm submissionId={s.id} initial={s.teacherCommentMd ?? ""} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewForm({ submissionId, initial }: { submissionId: string; initial: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const review = useServerFn(reviewSubmission);
  const [comment, setComment] = useState(initial);
  const [busy, setBusy] = useState<"reviewed" | "returned" | null>(null);
  const act = async (status: "reviewed" | "returned") => {
    setBusy(status);
    try {
      await review({ data: { submissionId, status, commentMd: comment.trim() || null } });
      await router.invalidate();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <Field label={t("teach.submissions.comment")} hint={t("assignment.text.hint")}>
        {(c) => (
          <Textarea {...c} rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          loading={busy === "reviewed"}
          onClick={() => act("reviewed")}
        >
          {t("teach.submissions.markReviewed")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          loading={busy === "returned"}
          onClick={() => act("returned")}
        >
          {t("teach.submissions.return")}
        </Button>
      </div>
    </div>
  );
}
