import { useState } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n";
import { SUBMISSION_TYPES } from "~/db/schema";
import { listCourseAssignments } from "~/server/queries/assignments";
import {
  createAssignment,
  deleteAssignment,
  updateAssignment,
} from "~/server/mutations/assignments";
import { MarkdownField } from "~/components/editor/MarkdownField";
import { SaveIndicator } from "~/components/editor/SaveIndicator";
import { useAutosave } from "~/components/editor/useAutosave";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Empty } from "~/components/ui/empty";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/assignments")({
  loader: async ({ params }) => {
    const data = await listCourseAssignments({ data: { courseSlug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const { t } = useI18n();
  const { course, assignments } = Route.useLoaderData();
  const router = useRouter();
  const { state, run } = useAutosave();
  const create = useServerFn(createAssignment);
  const update = useServerFn(updateAssignment);
  const remove = useServerFn(deleteAssignment);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = () => router.invalidate();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("teach.assignments.lead")}</p>
        <SaveIndicator state={state} />
      </div>
      {assignments.length === 0 ? <Empty title={t("common.empty")} /> : null}
      <ul className="flex flex-col gap-4">
        {assignments.map((a) => (
          <li key={a.id} className="grid gap-4 rounded-lg border bg-card p-5 lg:grid-cols-2">
            <Field label={t("teach.assignments.title")}>
              {(c) => (
                <Input
                  {...c}
                  defaultValue={a.title}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value.trim() !== a.title &&
                    run(() =>
                      update({
                        data: { assignmentId: a.id, patch: { title: e.target.value.trim() } },
                      }),
                    ).then(refresh)
                  }
                />
              )}
            </Field>
            <Field label={t("teach.assignments.type")}>
              {(c) => (
                <Select
                  {...c}
                  defaultValue={a.submissionType}
                  onChange={(e) =>
                    run(() =>
                      update({
                        data: {
                          assignmentId: a.id,
                          patch: {
                            submissionType: e.target.value as (typeof SUBMISSION_TYPES)[number],
                          },
                        },
                      }),
                    ).then(refresh)
                  }
                >
                  {SUBMISSION_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`teach.assignments.type.${s}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <AssignmentInstructions
              key={a.id}
              initial={a.instructionsMd}
              onSave={(md) =>
                run(() =>
                  update({ data: { assignmentId: a.id, patch: { instructionsMd: md } } }),
                ).then(refresh)
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
              <Checkbox
                label={t("teach.assignments.resubmit")}
                defaultChecked={a.allowResubmit}
                onChange={(e) =>
                  run(() =>
                    update({
                      data: { assignmentId: a.id, patch: { allowResubmit: e.target.checked } },
                    }),
                  ).then(refresh)
                }
              />
              <Button variant="ghost" size="sm" onClick={() => setDeleting(a.id)}>
                <Trash2 aria-hidden="true" />
                {t("teach.assignments.delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await run(() => create({ data: { courseId: course.id, title: title.trim() } }));
          setTitle("");
          await refresh();
        }}
      >
        <Input
          aria-label={t("teach.assignments.new")}
          placeholder={t("teach.assignments.title")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          <Plus aria-hidden="true" />
          {t("teach.assignments.new")}
        </Button>
      </form>
      <ConfirmDialog
        open={deleting !== null}
        title={t("teach.assignments.delete")}
        description={t("teach.assignments.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await run(() => remove({ data: { assignmentId: deleting } }));
          setDeleting(null);
          await refresh();
        }}
      />
    </div>
  );
}

function AssignmentInstructions({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (md: string) => void;
}) {
  const { t } = useI18n();
  const [md, setMd] = useState(initial);
  return (
    <Field label={t("teach.assignments.instructions")} className="lg:col-span-2">
      {(c) => (
        <MarkdownField
          id={c.id}
          value={md}
          onChange={setMd}
          onBlur={() => md !== initial && onSave(md)}
          rows={6}
        />
      )}
    </Field>
  );
}
