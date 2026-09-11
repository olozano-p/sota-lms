import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "~/i18n";
import { listTeachCourses } from "~/server/queries/teach";
import { createCourse } from "~/server/mutations/authoring";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty } from "~/components/ui/empty";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/teach/")({
  loader: () => listTeachCourses(),
  component: TeachIndex,
});

function TeachIndex() {
  const { t, fmtRelative } = useI18n();
  const { courses, isAdmin, languages } = Route.useLoaderData();
  const navigate = useNavigate();
  const create = useServerFn(createCourse);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<string>(languages[0] ?? "en");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const c = await create({ data: { title: title.trim(), language } });
      await navigate({ to: "/teach/courses/$courseSlug", params: { courseSlug: c.slug } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl">{t("teach.title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("teach.lead")}</p>
      </div>
      {courses.length === 0 ? (
        <Empty title={t("common.empty")}>{t("teach.courses.empty")}</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {courses.map((c) => (
            <li
              key={c.id}
              className="flex flex-col justify-between gap-4 rounded-lg border bg-card p-5"
            >
              <div className="flex flex-col gap-2">
                <Badge
                  variant={
                    c.status === "published"
                      ? "success"
                      : c.status === "archived"
                        ? "outline"
                        : "warning"
                  }
                >
                  {t(`teach.status.${c.status}`)}
                </Badge>
                <h2 className="font-serif text-xl font-medium tracking-normal">
                  <Link
                    to="/teach/courses/$courseSlug"
                    params={{ courseSlug: c.slug }}
                    className="text-foreground"
                  >
                    {c.title}
                  </Link>
                </h2>
                {c.subtitle ? <p className="text-sm text-muted-foreground">{c.subtitle}</p> : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t("teach.courses.lessons", {
                    published: c.publishedCount,
                    total: c.lessonCount,
                  })}
                </span>
                <span>{fmtRelative(c.updatedAt)}</span>
              </div>
              <Link
                to="/teach/courses/$courseSlug"
                params={{ courseSlug: c.slug }}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "self-start text-foreground no-underline hover:no-underline",
                )}
              >
                {t("teach.courses.edit")}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {isAdmin ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t("teach.courses.new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_auto]" noValidate>
              <Field label={t("teach.courses.new.title")}>
                {(c) => (
                  <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} required />
                )}
              </Field>
              <Field label={t("teach.courses.new.language")}>
                {(c) => (
                  <Select {...c} value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {languages.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" loading={busy}>
                  {t("teach.courses.new.submit")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
