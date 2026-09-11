import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { useI18n } from "~/i18n";
import { QUIZ_KINDS } from "~/db/schema";
import { listCourseQuizzes } from "~/server/queries/quizzes";
import { createQuiz } from "~/server/mutations/quizzes";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/quizzes")({
  loader: async ({ params }) => {
    const data = await listCourseQuizzes({ data: { courseSlug: params.courseSlug } });
    if (!data) throw notFound();
    return data;
  },
  component: QuizzesPage,
});

function QuizzesPage() {
  const { t } = useI18n();
  const { course, quizzes } = Route.useLoaderData();
  const router = useRouter();
  const create = useServerFn(createQuiz);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof QUIZ_KINDS)[number]>("quiz");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("teach.quizzes.lead")}</p>
      {quizzes.length === 0 ? <Empty title={t("common.empty")} /> : null}
      <ul className="flex flex-col gap-2">
        {quizzes.map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <Badge>{q.kind === "form" ? t("quiz.form") : t("quiz.title")}</Badge>
            <Link
              to="/teach/courses/$courseSlug/quizzes/$quizId"
              params={{ courseSlug: course.slug, quizId: q.id }}
              className="min-w-0 flex-1 truncate font-medium text-foreground"
            >
              {q.title}
            </Link>
            <Link
              to="/teach/courses/$courseSlug/quizzes/$quizId/results"
              params={{ courseSlug: course.slug, quizId: q.id }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "text-foreground no-underline hover:no-underline",
              )}
            >
              {t("teach.quizzes.results")}
            </Link>
            <Link
              to="/teach/courses/$courseSlug/quizzes/$quizId"
              params={{ courseSlug: course.slug, quizId: q.id }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "text-foreground no-underline hover:no-underline",
              )}
            >
              {t("teach.quizzes.edit")}
            </Link>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          setBusy(true);
          try {
            const q = await create({ data: { courseId: course.id, title: title.trim(), kind } });
            await router.navigate({
              to: "/teach/courses/$courseSlug/quizzes/$quizId",
              params: { courseSlug: course.slug, quizId: q.id },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          aria-label={t("teach.quizzes.new")}
          placeholder={t("teach.quizzes.title")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="max-w-md"
        />
        <Select
          aria-label={t("teach.quizzes.kind")}
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof QUIZ_KINDS)[number])}
          className="w-64"
        >
          {QUIZ_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`teach.quizzes.kind.${k}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" loading={busy}>
          <Plus aria-hidden="true" />
          {t("teach.quizzes.new")}
        </Button>
      </form>
    </div>
  );
}
