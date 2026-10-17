import { useState } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { useI18n } from "~/i18n";
import { lmsConfig } from "~/config";
import { getAssignment } from "~/server/queries/assignments";
import {
  confirmSubmissionUpload,
  requestSubmissionUpload,
  submitAssignment,
} from "~/server/mutations/assignments";
import { Markdown } from "~/components/player/Markdown";
import { UploadField, type UploadedFile } from "~/components/editor/UploadField";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { Eyebrow } from "~/components/ui/eyebrow";
import { Field } from "~/components/ui/field";
import { Textarea } from "~/components/ui/input";

export const Route = createFileRoute("/_authed/assignments/$assignmentId")({
  loader: async ({ params }) => {
    const data = await getAssignment({ data: { assignmentId: params.assignmentId } });
    if (!data) throw notFound();
    return data;
  },
  component: AssignmentPage,
});

function AssignmentPage() {
  const data = Route.useLoaderData();
  // The success notice outlives the keyed view, which remounts when a submission lands.
  const [done, setDone] = useState(false);
  return (
    <AssignmentView
      key={`${data.assignment.id}:${data.submissions.length}`}
      data={data}
      done={done}
      onDone={() => setDone(true)}
    />
  );
}

function AssignmentView({
  data,
  done,
  onDone,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getAssignment>>>;
  done: boolean;
  onDone: () => void;
}) {
  const { t, fmtDateTime } = useI18n();
  const { assignment, course, lesson, privileged, canSubmit, submissions } = data;
  const router = useRouter();
  const request = useServerFn(requestSubmissionUpload);
  const confirm = useServerFn(confirmSubmissionUpload);
  const submit = useServerFn(submitAssignment);
  const [text, setText] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = submissions.find((s) => !s.superseded) ?? null;
  const history = submissions.filter((s) => s.superseded);
  const wantsText = assignment.submissionType !== "file";
  const wantsFile = assignment.submissionType !== "text";

  const send = async () => {
    setError(null);
    if (!text.trim() && !file) {
      setError(t("assignment.empty"));
      return;
    }
    setBusy(true);
    try {
      await submit({
        data: {
          assignmentId: assignment.id,
          textMd: text.trim() || null,
          fileKey: file?.key ?? null,
        },
      });
      onDone();
      await router.invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        crumbs={[
          { label: t("nav.courses"), link: { to: "/courses" } },
          {
            label: course.title,
            link: { to: "/courses/$courseSlug", params: { courseSlug: course.slug } },
          },
          ...(lesson
            ? [
                {
                  label: lesson.title,
                  link: {
                    to: "/courses/$courseSlug/$lessonSlug" as const,
                    params: { courseSlug: course.slug, lessonSlug: lesson.slug },
                  },
                },
              ]
            : []),
          { label: t("assignment.title") },
        ]}
        title={assignment.title}
      />

      <section className="flex flex-col gap-3">
        <h2 className="label text-muted-foreground">{t("assignment.instructions")}</h2>
        <Markdown html={assignment.instructionsHtml} />
      </section>

      {privileged ? <Alert>{t("assignment.teacherView")}</Alert> : null}

      {current ? (
        <section className="flex flex-col gap-4 rounded-lg bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="label text-muted-foreground">{t("assignment.yourSubmission")}</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("assignment.submitted", { date: fmtDateTime(current.submittedAt) })}</span>
              <Badge
                variant={
                  current.status === "returned"
                    ? "warning"
                    : current.status === "reviewed"
                      ? "success"
                      : "info"
                }
              >
                {t(`assignment.status.${current.status}`)}
              </Badge>
            </div>
          </div>
          {current.textHtml ? (
            <Markdown html={current.textHtml} className="prose text-[0.95rem]" />
          ) : null}
          {current.file ? (
            <a href={current.file.url} className="inline-flex items-center gap-2 text-sm">
              <Download className="size-4" aria-hidden="true" />
              {current.file.filename}
            </a>
          ) : null}
          {current.teacherCommentHtml ? (
            <div className="flex flex-col gap-2 pt-2">
              <Eyebrow>{t("assignment.feedback")}</Eyebrow>
              <Markdown html={current.teacherCommentHtml} className="prose text-[0.95rem]" />
            </div>
          ) : null}
        </section>
      ) : null}

      {done ? <Alert variant="success">{t("assignment.done")}</Alert> : null}

      {canSubmit ? (
        <section className="flex flex-col gap-4 rounded-lg bg-card p-6">
          <h2 className="label text-muted-foreground">
            {current ? t("assignment.resubmit") : t("assignment.yourSubmission")}
          </h2>
          {wantsText ? (
            <Field label={t("assignment.text")} hint={t("assignment.text.hint")}>
              {(c) => (
                <Textarea {...c} rows={10} value={text} onChange={(e) => setText(e.target.value)} />
              )}
            </Field>
          ) : null}
          {wantsFile ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t("assignment.file")}</span>
              <UploadField
                accept={lmsConfig.uploads.allowedMime}
                maxBytes={lmsConfig.uploads.maxBytes}
                current={file ? { key: file.key } : null}
                request={(f) => request({ data: { assignmentId: assignment.id, ...f } })}
                confirm={(key, filename) =>
                  confirm({ data: { assignmentId: assignment.id, key, filename } })
                }
                onUploaded={setFile}
              />
            </div>
          ) : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div>
            <Button onClick={send} loading={busy}>
              {current ? t("assignment.resubmit") : t("assignment.submit")}
            </Button>
          </div>
        </section>
      ) : current && !privileged ? (
        <p className="text-sm text-muted-foreground">{t("assignment.noResubmit")}</p>
      ) : null}

      {history.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="label text-muted-foreground">{t("assignment.history")}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {history.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded bg-card px-3 py-2 text-muted-foreground"
              >
                <span>{fmtDateTime(s.submittedAt)}</span>
                <Badge>{t(`assignment.status.${s.status}`)}</Badge>
                {s.file ? (
                  <a href={s.file.url} className="ml-auto">
                    {s.file.filename}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
