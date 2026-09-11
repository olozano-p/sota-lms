import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { getQuizResults } from "~/server/queries/quizzes";
import { Markdown } from "~/components/player/Markdown";
import { Badge } from "~/components/ui/badge";
import { Empty } from "~/components/ui/empty";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug_/quizzes/$quizId/results")(
  {
    loader: async ({ params }) => {
      const data = await getQuizResults({ data: { quizId: params.quizId } });
      if (!data || data.course.slug !== params.courseSlug) throw notFound();
      return data;
    },
    component: ResultsPage,
  },
);

function ResultsPage() {
  const { t, fmtDateTime } = useI18n();
  const { quiz, course, attempts, questions, respondents } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          to="/teach/courses/$courseSlug/quizzes/$quizId"
          params={{ courseSlug: course.slug, quizId: quiz.id }}
          className="text-sm"
        >
          ← {quiz.title}
        </Link>
        <h1 className="text-3xl">{t("teach.quizzes.results")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("teach.quizzes.results.lead")} ·{" "}
          {t("teach.quizzes.results.respondents", { n: respondents })}
        </p>
      </div>

      <section className="flex flex-col gap-6">
        {questions.map((q, i) => {
          const total = q.options.reduce((n, o) => n + o.count, 0);
          return (
            <div key={q.id} className="flex flex-col gap-3 rounded-lg border bg-card p-5">
              <div className="flex items-baseline gap-3">
                <span className="font-serif text-lg text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <Markdown html={q.promptHtml} className="prose text-[1rem]" />
              </div>
              {q.options.length ? (
                <ul className="flex flex-col gap-2">
                  {q.options.map((o) => (
                    <li key={o.id} className="flex flex-col gap-1 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn(o.isCorrect && "font-medium")}>
                          {o.label}
                          {o.isCorrect ? (
                            <span className="ml-2 text-xs text-success-foreground">
                              {t("quiz.correctAnswer")}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground tabular-nums">{o.count}</span>
                      </div>
                      <div className="h-0.5 w-full bg-border">
                        <div
                          className={cn(
                            "h-full",
                            o.isCorrect ? "bg-primary" : "bg-muted-foreground/50",
                          )}
                          style={{ width: `${total ? (o.count / total) * 100 : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : q.texts.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {q.texts.map((a, j) => (
                    <li key={j} className="rounded bg-muted px-3 py-2">
                      <p className="whitespace-pre-wrap">{a.text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{a.personName}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("common.empty")}</p>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">{t("teach.quizzes.results.attempts")}</h2>
        {attempts.length === 0 ? (
          <Empty title={t("common.empty")} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("teach.submissions.student")}</Th>
                <Th>{t("quiz.result.submitted", { date: "" }).replace(/\s+$/, "")}</Th>
                <Th className="text-right">{t("teach.quizzes.results.score")}</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {attempts.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <div className="font-medium">{a.personName}</div>
                    <div className="text-xs text-muted-foreground">{a.personEmail}</div>
                  </Td>
                  <Td className="tabular-nums">
                    {a.submittedAt ? fmtDateTime(a.submittedAt) : "—"}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {a.score === null ? "—" : `${a.score} %`}
                  </Td>
                  <Td>
                    {a.passed === true ? (
                      <Badge variant="success">{t("quiz.result.passed")}</Badge>
                    ) : a.passed === false ? (
                      <Badge variant="warning">
                        {t("quiz.result.failed", { min: quiz.passThreshold ?? 0 })}
                      </Badge>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
