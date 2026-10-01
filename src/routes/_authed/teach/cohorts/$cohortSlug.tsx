import { useState } from "react";
import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Plus, Trash2, Users, X } from "lucide-react";
import { useI18n } from "~/i18n";
import { COHORT_STATUSES } from "~/db/schema";
import { getCohortEditor } from "~/server/queries/cohorts";
import {
  addCohortMember,
  addRelease,
  applyCohortDrip,
  deleteCohort,
  deleteRelease,
  removeCohortMember,
  updateCohort,
} from "~/server/mutations/cohorts";
import { enrollCohort } from "~/server/mutations/enrollments";
import { EmailEnrollForm } from "~/components/enroll/EmailEnrollForm";
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
  const mDrip = useServerFn(applyCohortDrip);
  const mEnrollCohort = useServerFn(enrollCohort);
  const [drip, setDrip] = useState({
    everyDays: "7",
    chaptersPerStep: "1",
    startDate: cohort.startsAt ?? "",
  });
  const [confirmDrip, setConfirmDrip] = useState(false);
  const [dripMsg, setDripMsg] = useState<string | null>(null);
  const [dripBusy, setDripBusy] = useState(false);
  const [enrolledMsg, setEnrolledMsg] = useState<string | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const hasChapterReleases = releases.some((r) => r.chapterTitle != null);
  const dripValid =
    Number.parseInt(drip.everyDays, 10) >= 1 &&
    Number.parseInt(drip.chaptersPerStep, 10) >= 1 &&
    Boolean(drip.startDate || cohort.startsAt);
  const runDrip = async () => {
    setDripBusy(true);
    setDripMsg(null);
    try {
      const r = await run(() =>
        mDrip({
          data: {
            cohortId: cohort.id,
            everyDays: Number.parseInt(drip.everyDays, 10),
            chaptersPerStep: Number.parseInt(drip.chaptersPerStep, 10),
            startDate: drip.startDate || null,
          },
        }),
      );
      setDripMsg(t("teach.cohorts.drip.done", { n: r?.count ?? 0 }));
      await refresh();
    } finally {
      setDripBusy(false);
    }
  };
  const runEnrollCohort = async () => {
    setEnrollBusy(true);
    setEnrolledMsg(null);
    try {
      const r = await run(() => mEnrollCohort({ data: { cohortId: cohort.id } }));
      setEnrolledMsg(t("teach.cohorts.enrollAll.done", { n: r?.enrolled ?? 0 }));
    } finally {
      setEnrollBusy(false);
    }
  };
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
        <form
          className="flex flex-col gap-3 rounded-lg border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dripValid) return;
            if (hasChapterReleases) setConfirmDrip(true);
            else void runDrip();
          }}
        >
          <div>
            <h3 className="text-base font-semibold">{t("teach.cohorts.drip")}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("teach.cohorts.drip.lead")}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("teach.cohorts.drip.every")}>
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  min={1}
                  step={1}
                  value={drip.everyDays}
                  onChange={(e) => setDrip({ ...drip, everyDays: e.target.value })}
                  className="w-28"
                />
              )}
            </Field>
            <Field label={t("teach.cohorts.drip.per")}>
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  min={1}
                  step={1}
                  value={drip.chaptersPerStep}
                  onChange={(e) => setDrip({ ...drip, chaptersPerStep: e.target.value })}
                  className="w-28"
                />
              )}
            </Field>
            <Field label={t("teach.cohorts.drip.start")}>
              {(c) => (
                <Input
                  {...c}
                  type="date"
                  value={drip.startDate}
                  onChange={(e) => setDrip({ ...drip, startDate: e.target.value })}
                />
              )}
            </Field>
            <Button type="submit" variant="outline" loading={dripBusy} disabled={!dripValid}>
              <CalendarClock aria-hidden="true" />
              {t("teach.cohorts.drip.apply")}
            </Button>
          </div>
          {!cohort.startsAt && !drip.startDate ? (
            <p className="text-xs text-muted-foreground">{t("teach.cohorts.drip.noStart")}</p>
          ) : null}
          {dripMsg ? (
            <p role="status" className="text-sm">
              {dripMsg}
            </p>
          ) : null}
        </form>
        <ConfirmDialog
          open={confirmDrip}
          title={t("teach.cohorts.drip")}
          description={t("teach.cohorts.drip.confirm")}
          confirmLabel={t("teach.cohorts.drip.apply")}
          onClose={() => setConfirmDrip(false)}
          onConfirm={runDrip}
        />
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
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <div>
            <h3 className="text-base font-semibold">{t("teach.cohorts.enrollAll")}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("teach.cohorts.enrollAll.lead")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" loading={enrollBusy} onClick={runEnrollCohort}>
              <Users aria-hidden="true" />
              {t("teach.cohorts.enrollAll")}
            </Button>
            {enrolledMsg ? (
              <p role="status" className="text-sm">
                {enrolledMsg}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <div>
            <h3 className="text-base font-semibold">{t("enroll.title")}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("teach.cohorts.enrollEmails.lead")}
            </p>
          </div>
          <EmailEnrollForm courseId={course.id} cohortSlug={cohort.slug} onDone={refresh} />
        </div>
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
