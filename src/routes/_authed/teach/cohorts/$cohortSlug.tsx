import { useState } from "react";
import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, X } from "lucide-react";
import { useI18n } from "~/i18n";
import { COHORT_STATUSES } from "~/db/schema";
import { getCohortEditor } from "~/server/queries/cohorts";
import {
  addCohortMember,
  addRelease,
  deleteCohort,
  deleteRelease,
  removeCohortMember,
  updateCohort,
} from "~/server/mutations/cohorts";
import { SaveIndicator } from "~/components/editor/SaveIndicator";
import { useAutosave } from "~/components/editor/useAutosave";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/teach/cohorts/$cohortSlug")({
  loader: async ({ params }) => {
    const data = await getCohortEditor({ data: { slug: params.cohortSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: CohortEditorPage,
});

function CohortEditorPage() {
  const { t, fmtDateTime } = useI18n();
  const { cohort, course, members, releases, chapters, lessons } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const { state, run } = useAutosave();
  const mUpdate = useServerFn(updateCohort);
  const mDelete = useServerFn(deleteCohort);
  const mAddMember = useServerFn(addCohortMember);
  const mRemoveMember = useServerFn(removeCohortMember);
  const mAddRelease = useServerFn(addRelease);
  const mDeleteRelease = useServerFn(deleteRelease);
  const [email, setEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"student" | "teacher">("student");
  const [target, setTarget] = useState("");
  const [at, setAt] = useState("");
  const [deleting, setDeleting] = useState(false);
  const refresh = () => router.invalidate();
  const patch = (p: Parameters<typeof updateCohort>[0]["data"]["patch"]) =>
    run(() => mUpdate({ data: { cohortId: cohort.id, patch: p } })).then(refresh);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          to="/teach/courses/$courseSlug/cohorts"
          params={{ courseSlug: course.slug }}
          className="text-sm"
        >
          ← {course.title} · {t("teach.tabs.cohorts")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl">{cohort.title}</h1>
          <div className="flex items-center gap-2">
            <SaveIndicator state={state} />
            <Link
              to="/cohorts/$cohortSlug"
              params={{ cohortSlug: cohort.slug }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "text-foreground no-underline hover:no-underline",
              )}
            >
              {t("teach.cohorts.view")}
            </Link>
          </div>
        </div>
      </div>

      <section className="grid gap-5 rounded-lg border bg-card p-5 lg:grid-cols-4">
        <Field label={t("teach.cohorts.title")} className="lg:col-span-2">
          {(c) => (
            <Input
              {...c}
              defaultValue={cohort.title}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value.trim() !== cohort.title &&
                patch({ title: e.target.value.trim() })
              }
            />
          )}
        </Field>
        <Field
          label={t("teach.cohorts.slug")}
          hint={t("teach.settings.slug.hint")}
          className="lg:col-span-2"
        >
          {(c) => (
            <Input
              {...c}
              defaultValue={cohort.slug}
              className="font-mono"
              onBlur={(e) => e.target.value !== cohort.slug && patch({ slug: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("teach.cohorts.starts")}>
          {(c) => (
            <Input
              {...c}
              type="date"
              defaultValue={cohort.startsAt ?? ""}
              onBlur={(e) =>
                (e.target.value || null) !== cohort.startsAt &&
                patch({ startsAt: e.target.value || null })
              }
            />
          )}
        </Field>
        <Field label={t("teach.cohorts.ends")}>
          {(c) => (
            <Input
              {...c}
              type="date"
              defaultValue={cohort.endsAt ?? ""}
              onBlur={(e) =>
                (e.target.value || null) !== cohort.endsAt &&
                patch({ endsAt: e.target.value || null })
              }
            />
          )}
        </Field>
        <Field label={t("teach.cohorts.status")}>
          {(c) => (
            <Select
              {...c}
              defaultValue={cohort.status}
              onChange={(e) =>
                patch({ status: e.target.value as (typeof COHORT_STATUSES)[number] })
              }
            >
              {COHORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`cohort.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">{t("teach.cohorts.schedule")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("teach.cohorts.schedule.lead")}
          </p>
        </div>
        {releases.length ? (
          <Table>
            <THead>
              <tr>
                <Th>{t("teach.cohorts.schedule.target")}</Th>
                <Th>{t("teach.cohorts.schedule.at")}</Th>
                <Th />
                <Th />
              </tr>
            </THead>
            <TBody>
              {releases.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.chapterTitle ?? r.lessonTitle}</Td>
                  <Td className="tabular-nums">{fmtDateTime(r.releaseAt)}</Td>
                  <Td>
                    {r.notifiedAt ? (
                      <Badge variant="success">{t("teach.cohorts.schedule.notified")}</Badge>
                    ) : null}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("teach.cohorts.schedule.remove")}
                      onClick={() =>
                        run(() => mDeleteRelease({ data: { releaseId: r.id } })).then(refresh)
                      }
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!target || !at) return;
            const [kind, tid] = target.split(":");
            await run(() =>
              mAddRelease({
                data: {
                  cohortId: cohort.id,
                  chapterId: kind === "chapter" ? tid! : null,
                  lessonId: kind === "lesson" ? tid! : null,
                  releaseAt: new Date(at).toISOString(),
                },
              }),
            );
            setTarget("");
            setAt("");
            await refresh();
          }}
        >
          <Field label={t("teach.cohorts.schedule.target")}>
            {(c) => (
              <Select
                {...c}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-72"
              >
                <option value="">{t("teach.block.none")}</option>
                {chapters.map((ch) => (
                  <optgroup key={ch.id} label={ch.title}>
                    <option value={`chapter:${ch.id}`}>{ch.title}</option>
                    {lessons
                      .filter((l) => l.chapterId === ch.id)
                      .map((l) => (
                        <option key={l.id} value={`lesson:${l.id}`}>
                          — {l.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("teach.cohorts.schedule.at")}>
            {(c) => (
              <Input
                {...c}
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="outline">
            <Plus aria-hidden="true" />
            {t("teach.cohorts.schedule.add")}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">{t("teach.cohorts.members")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("teach.cohorts.members.lead")}
          </p>
        </div>
        <Table>
          <THead>
            <tr>
              <Th>{t("common.name")}</Th>
              <Th>{t("teach.cohorts.members.role")}</Th>
              <Th />
            </tr>
          </THead>
          <TBody>
            {members.map((m) => (
              <Tr key={m.personId}>
                <Td>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </Td>
                <Td>
                  <Badge variant={m.role === "teacher" ? "success" : "outline"}>
                    {t(`role.${m.role}`)}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("teach.cohorts.members.remove")}
                    onClick={() =>
                      run(() =>
                        mRemoveMember({ data: { cohortId: cohort.id, personId: m.personId } }),
                      ).then(refresh)
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            await run(() =>
              mAddMember({ data: { cohortId: cohort.id, email: email.trim(), role: memberRole } }),
            );
            setEmail("");
            await refresh();
          }}
        >
          <Field label={t("common.email")}>
            {(c) => (
              <Input
                {...c}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-72"
              />
            )}
          </Field>
          <Field label={t("teach.cohorts.members.role")}>
            {(c) => (
              <Select
                {...c}
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as "student" | "teacher")}
                className="w-40"
              >
                <option value="student">{t("role.student")}</option>
                <option value="teacher">{t("role.teacher")}</option>
              </Select>
            )}
          </Field>
          <Button type="submit" variant="outline">
            <Plus aria-hidden="true" />
            {t("teach.cohorts.members.add")}
          </Button>
        </form>
      </section>

      <div className="border-t pt-6">
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden="true" />
          {t("teach.cohorts.delete")}
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        title={t("teach.cohorts.delete")}
        description={t("teach.cohorts.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await run(() => mDelete({ data: { cohortId: cohort.id } }));
          await navigate({
            to: "/teach/courses/$courseSlug/cohorts",
            params: { courseSlug: course.slug },
          });
        }}
      />
    </div>
  );
}
