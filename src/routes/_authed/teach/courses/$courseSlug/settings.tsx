import { useState } from "react";
import { createFileRoute, useRouter, getRouteApi } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "~/i18n";
import { COURSE_STATUSES } from "~/db/schema";
import { setCourseTeachers, updateCourse } from "~/server/mutations/authoring";
import { MarkdownField } from "~/components/editor/MarkdownField";
import { SaveIndicator } from "~/components/editor/SaveIndicator";
import { useAutosave } from "~/components/editor/useAutosave";
import { Checkbox } from "~/components/ui/checkbox";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";

const parent = getRouteApi("/_authed/teach/courses/$courseSlug");

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();
  const { course, isAdmin, teachers, candidates, languages } = parent.useLoaderData();
  const router = useRouter();
  const { state, run } = useAutosave();
  const update = useServerFn(updateCourse);
  const setTeachers = useServerFn(setCourseTeachers);
  const [description, setDescription] = useState(course.descriptionMd);

  const patch = (p: Parameters<typeof updateCourse>[0]["data"]["patch"]) =>
    run(() => update({ data: { courseId: course.id, patch: p } })).then(() => router.invalidate());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end">
        <SaveIndicator state={state} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field label={t("teach.settings.title")}>
          {(c) => (
            <Input
              {...c}
              defaultValue={course.title}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value.trim() !== course.title &&
                patch({ title: e.target.value.trim() })
              }
            />
          )}
        </Field>
        <Field label={t("teach.settings.slug")} hint={t("teach.settings.slug.hint")}>
          {(c) => (
            <Input
              {...c}
              defaultValue={course.slug}
              className="font-mono"
              onBlur={(e) => e.target.value !== course.slug && patch({ slug: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("teach.settings.subtitle")} className="lg:col-span-2">
          {(c) => (
            <Input
              {...c}
              defaultValue={course.subtitle ?? ""}
              onBlur={(e) =>
                (e.target.value.trim() || null) !== course.subtitle &&
                patch({ subtitle: e.target.value.trim() || null })
              }
            />
          )}
        </Field>
        <Field label={t("teach.settings.description")} className="lg:col-span-2">
          {(c) => (
            <MarkdownField
              id={c.id}
              value={description}
              onChange={setDescription}
              onBlur={() =>
                description !== course.descriptionMd && patch({ descriptionMd: description })
              }
              rows={8}
            />
          )}
        </Field>
        <Field label={t("teach.settings.language")}>
          {(c) => (
            <Select
              {...c}
              defaultValue={course.language}
              onChange={(e) => patch({ language: e.target.value })}
            >
              {[...new Set([course.language, ...languages])].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("teach.settings.status")}>
          {(c) => (
            <Select
              {...c}
              defaultValue={course.status}
              onChange={(e) =>
                patch({ status: e.target.value as (typeof COURSE_STATUSES)[number] })
              }
            >
              {COURSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`teach.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("teach.settings.endedAt")}
          hint={t("common.optional")}
          description={t("teach.settings.endedAt.hint")}
        >
          {(c) => (
            <Input
              {...c}
              type="date"
              defaultValue={course.endedAt ?? ""}
              onBlur={(e) =>
                (e.target.value || null) !== course.endedAt &&
                patch({ endedAt: e.target.value || null })
              }
            />
          )}
        </Field>
      </div>

      <section className="flex flex-col gap-3 border-t pt-6">
        <div>
          <h2 className="text-lg">{t("teach.settings.teachers")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("teach.settings.teachers.lead")}
          </p>
        </div>
        {isAdmin ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {candidates.map((p) => (
              <li key={p.id}>
                <Checkbox
                  label={p.name}
                  description={p.email}
                  checked={teachers.some((x) => x.id === p.id)}
                  onChange={(e) => {
                    const ids = new Set(teachers.map((x) => x.id));
                    if (e.target.checked) ids.add(p.id);
                    else ids.delete(p.id);
                    run(() =>
                      setTeachers({ data: { courseId: course.id, personIds: [...ids] } }),
                    ).then(() => router.invalidate());
                  }}
                />
              </li>
            ))}
          </ul>
        ) : teachers.length ? (
          <ul className="text-sm">
            {teachers.map((p) => (
              <li key={p.id}>
                {p.name} <span className="text-muted-foreground">· {p.email}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("teach.settings.teachers.none")}</p>
        )}
      </section>
    </div>
  );
}
