import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
import { useI18n } from "~/i18n";
import { getQuiz } from "~/server/queries/quizzes";
import { submitQuizAttempt } from "~/server/mutations/quizzes";
import { Markdown } from "~/components/player/Markdown";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox, Radio } from "~/components/ui/checkbox";
import { Eyebrow } from "~/components/ui/eyebrow";
import { Input, Textarea } from "~/components/ui/input";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/quizzes/$quizId")({
  loader: async ({ params }) => {
    const data = await getQuiz({ data: { quizId: params.quizId } });
    if (!data) throw notFound();
    return data;
  },
  component: QuizPage,
});

type Answer = { optionIds: string[]; text: string };

function QuizPage() {
  const data = Route.useLoaderData();
  return <QuizView key={`${data.quiz.id}:${data.attemptCount}`} data={data} />;
}

function QuizView({ data }: { data: NonNullable<Awaited<ReturnType<typeof getQuiz>>> }) {
  const { t, fmtDateTime } = useI18n();
  const { quiz, course, lesson, questions, latestAttempt, attemptCount, privileged } = data;
  const router = useRouter();
  const submit = useServerFn(submitQuizAttempt);
  const [retaking, setRetaking] = useState(false);
  const showResult = latestAttempt !== null && !retaking;
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, { optionIds: [], text: "" }])),
  );
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAnswer = (qid: string, patch: Partial<Answer>) =>
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid]!, ...patch } }));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await submit({
        data: {
          quizId: quiz.id,
          answers: questions.map((q) => ({
            questionId: q.id,
            optionIds: answers[q.id]!.optionIds,
            text: answers[q.id]!.text || null,
          })),
        },
      });
      if (!r.ok) {
        setMissing(r.missingRequired);
        return;
      }
      setMissing([]);
      setRetaking(false);
      await router.invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const given = (qid: string) => latestAttempt?.answers.find((a) => a.questionId === qid);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        {lesson ? (
          <Link
            to="/courses/$courseSlug/$lessonSlug"
            params={{ courseSlug: course.slug, lessonSlug: lesson.slug }}
            className="text-sm"
          >
            ← {lesson.title}
          </Link>
        ) : (
          <Link to="/courses/$courseSlug" params={{ courseSlug: course.slug }} className="text-sm">
            ← {course.title}
          </Link>
        )}
        <Eyebrow>{quiz.kind === "form" ? t("quiz.form") : t("quiz.title")}</Eyebrow>
        <h1 className="text-4xl leading-tight">{quiz.title}</h1>
        {quiz.introHtml ? <Markdown html={quiz.introHtml} className="prose text-[1rem]" /> : null}
      </header>

      {showResult && latestAttempt ? (
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            {latestAttempt.score !== null ? (
              <span className="font-serif text-2xl tabular-nums">
                {t("quiz.result.score", { score: latestAttempt.score })}
              </span>
            ) : (
              <span className="font-serif text-xl">{t("quiz.result.thanks")}</span>
            )}
            {latestAttempt.passed === true ? (
              <Badge variant="success">{t("quiz.result.passed")}</Badge>
            ) : null}
            {latestAttempt.passed === false ? (
              <Badge variant="warning">
                {t("quiz.result.failed", { min: quiz.passThreshold ?? 0 })}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {latestAttempt.submittedAt
              ? t("quiz.result.submitted", { date: fmtDateTime(latestAttempt.submittedAt) })
              : null}{" "}
            · {t("quiz.attempts", { n: attemptCount })}
          </p>
          {!privileged ? (
            <div>
              <Button variant="outline" onClick={() => setRetaking(true)}>
                {t("quiz.retake")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <ol className="flex flex-col gap-6">
        {questions.map((q, i) => {
          const correct = showResult ? latestAttempt?.correctByQuestion?.[q.id] : undefined;
          const a = answers[q.id]!;
          const g = showResult ? given(q.id) : undefined;
          const isMissing = missing.includes(q.id);
          return (
            <li
              key={q.id}
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-5",
                isMissing && "border-destructive",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <span className="font-serif text-lg text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <Markdown html={q.promptHtml} className="prose text-[1rem]" />
                </div>
                {correct === true ? (
                  <Badge variant="success">
                    <Check aria-hidden="true" /> {t("quiz.correct")}
                  </Badge>
                ) : correct === false ? (
                  <Badge variant="destructive">
                    <X aria-hidden="true" /> {t("quiz.incorrect")}
                  </Badge>
                ) : q.required ? (
                  <span className="text-xs text-muted-foreground">{t("quiz.required")}</span>
                ) : null}
              </div>
              {q.type === "single_choice" || q.type === "multi_choice" ? (
                <div className="flex flex-col">
                  {q.options.map((o) => {
                    const chosen = showResult
                      ? (g?.optionIds.includes(o.id) ?? false)
                      : a.optionIds.includes(o.id);
                    const Control = q.type === "single_choice" ? Radio : Checkbox;
                    return (
                      <Control
                        key={o.id}
                        name={q.id}
                        value={o.id}
                        disabled={showResult}
                        checked={chosen}
                        onChange={(e) =>
                          setAnswer(q.id, {
                            optionIds:
                              q.type === "single_choice"
                                ? [o.id]
                                : e.target.checked
                                  ? [...a.optionIds, o.id]
                                  : a.optionIds.filter((x) => x !== o.id),
                          })
                        }
                        label={
                          <span
                            className={cn(
                              "inline-flex items-center gap-2",
                              showResult && o.isCorrect && "font-medium",
                            )}
                          >
                            {o.label}
                            {showResult && o.isCorrect ? (
                              <span className="text-xs text-success-foreground">
                                · {t("quiz.correctAnswer")}
                              </span>
                            ) : null}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              ) : showResult ? (
                <p className="whitespace-pre-wrap rounded bg-muted px-3 py-2 text-sm">
                  {g?.text ?? "—"}
                </p>
              ) : q.type === "short_text" ? (
                <Input
                  aria-label={t("quiz.answer.placeholder")}
                  placeholder={t("quiz.answer.placeholder")}
                  value={a.text}
                  onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                />
              ) : (
                <Textarea
                  aria-label={t("quiz.answer.placeholder")}
                  placeholder={t("quiz.answer.placeholder")}
                  rows={5}
                  value={a.text}
                  onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ol>

      {!showResult ? (
        <div className="flex flex-col gap-3">
          {missing.length ? <Alert variant="warning">{t("quiz.missing")}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button onClick={send} loading={busy} disabled={privileged}>
              {t("quiz.submit")}
            </Button>
            {retaking ? (
              <Button variant="ghost" onClick={() => setRetaking(false)}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
