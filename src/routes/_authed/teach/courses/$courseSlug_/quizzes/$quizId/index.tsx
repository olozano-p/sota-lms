import { useState } from "react";
import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n";
import { QUESTION_TYPES, QUIZ_KINDS, type QuestionType } from "~/db/schema";
import { getQuizEditor } from "~/server/queries/quizzes";
import {
  createOption,
  createQuestion,
  deleteOption,
  deleteQuestion,
  deleteQuiz,
  reorderQuestions,
  updateOption,
  updateQuestion,
  updateQuiz,
} from "~/server/mutations/quizzes";
import { RichTextField } from "~/components/editor/RichTextField";
import { SortableList } from "~/components/editor/SortableList";
import { SaveIndicator } from "~/components/editor/SaveIndicator";
import { useAutosave } from "~/components/editor/useAutosave";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Empty } from "~/components/ui/empty";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug_/quizzes/$quizId/")({
  loader: async ({ params }) => {
    const data = await getQuizEditor({ data: { quizId: params.quizId } });
    if (!data || data.course.slug !== params.courseSlug) throw notFound();
    return data;
  },
  component: QuizEditorPage,
});

function QuizEditorPage() {
  const data = Route.useLoaderData();
  return <QuizEditor key={`${data.quiz.id}:${data.questions.length}`} data={data} />;
}

function QuizEditor({ data }: { data: NonNullable<Awaited<ReturnType<typeof getQuizEditor>>> }) {
  const { t } = useI18n();
  const { quiz, course, questions } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const { state, run } = useAutosave();
  const mUpdateQuiz = useServerFn(updateQuiz);
  const mDeleteQuiz = useServerFn(deleteQuiz);
  const mCreateQuestion = useServerFn(createQuestion);
  const mUpdateQuestion = useServerFn(updateQuestion);
  const mDeleteQuestion = useServerFn(deleteQuestion);
  const mReorder = useServerFn(reorderQuestions);
  const mCreateOption = useServerFn(createOption);
  const mUpdateOption = useServerFn(updateOption);
  const mDeleteOption = useServerFn(deleteOption);
  const [intro, setIntro] = useState(quiz.introMd);
  const [newType, setNewType] = useState<QuestionType>("single_choice");
  const [deleting, setDeleting] = useState(false);
  const refresh = () => router.invalidate();
  const patch = (p: Parameters<typeof updateQuiz>[0]["data"]["patch"]) =>
    run(() => mUpdateQuiz({ data: { quizId: quiz.id, patch: p } })).then(refresh);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          to="/teach/courses/$courseSlug/quizzes"
          params={{ courseSlug: course.slug }}
          className="text-sm"
        >
          ← {course.title} · {t("teach.tabs.quizzes")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl">{quiz.title}</h1>
          <div className="flex items-center gap-2">
            <SaveIndicator state={state} />
            <Link
              to="/teach/courses/$courseSlug/quizzes/$quizId/results"
              params={{ courseSlug: course.slug, quizId: quiz.id }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "text-foreground no-underline hover:no-underline",
              )}
            >
              {t("teach.quizzes.results")}
            </Link>
            <Link
              to="/quizzes/$quizId"
              params={{ quizId: quiz.id }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "text-foreground no-underline hover:no-underline",
              )}
            >
              {t("teach.lesson.preview")}
            </Link>
          </div>
        </div>
      </div>

      <section className="grid gap-5 rounded-lg border bg-card p-5 lg:grid-cols-3">
        <Field label={t("teach.quizzes.title")} className="lg:col-span-2">
          {(c) => (
            <Input
              {...c}
              defaultValue={quiz.title}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value.trim() !== quiz.title &&
                patch({ title: e.target.value.trim() })
              }
            />
          )}
        </Field>
        <Field label={t("teach.quizzes.kind")}>
          {(c) => (
            <Select
              {...c}
              defaultValue={quiz.kind}
              onChange={(e) => patch({ kind: e.target.value as (typeof QUIZ_KINDS)[number] })}
            >
              {QUIZ_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`teach.quizzes.kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("teach.quizzes.intro")} className="lg:col-span-3">
          {(c) => (
            <RichTextField
              id={c.id}
              value={intro}
              onChange={setIntro}
              onBlur={() => intro !== quiz.introMd && patch({ introMd: intro })}
              minHeightClass="min-h-28"
            />
          )}
        </Field>
        <Field label={t("teach.quizzes.threshold")} hint={t("teach.quizzes.threshold.hint")}>
          {(c) => (
            <Input
              {...c}
              type="number"
              min={0}
              max={100}
              defaultValue={quiz.passThreshold ?? ""}
              onBlur={(e) =>
                (e.target.value === "" ? null : Number(e.target.value)) !== quiz.passThreshold &&
                patch({ passThreshold: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
        <div className="flex items-end lg:col-span-2">
          <Checkbox
            label={t("teach.quizzes.showAnswers")}
            defaultChecked={quiz.showAnswersAfterSubmit}
            onChange={(e) => patch({ showAnswersAfterSubmit: e.target.checked })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg">{t("teach.quizzes.questions")}</h2>
        {questions.length === 0 ? <Empty title={t("teach.quizzes.noQuestions")} /> : null}
        <SortableList
          items={questions}
          onReorder={(ids) =>
            run(() => mReorder({ data: { quizId: quiz.id, orderedIds: ids } })).then(refresh)
          }
          renderItem={(q) => (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 lg:grid-cols-[1fr_12rem_auto] lg:items-end">
                <QuestionPrompt
                  initial={q.promptMd}
                  onSave={(md) =>
                    run(() =>
                      mUpdateQuestion({ data: { questionId: q.id, patch: { promptMd: md } } }),
                    ).then(refresh)
                  }
                />
                <Field label={t("teach.quizzes.question.type")}>
                  {(c) => (
                    <Select
                      {...c}
                      defaultValue={q.type}
                      onChange={(e) =>
                        run(() =>
                          mUpdateQuestion({
                            data: {
                              questionId: q.id,
                              patch: { type: e.target.value as QuestionType },
                            },
                          }),
                        ).then(refresh)
                      }
                    >
                      {QUESTION_TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`teach.quizzes.question.type.${ty}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox
                    label={t("teach.quizzes.question.required")}
                    defaultChecked={q.required}
                    onChange={(e) =>
                      run(() =>
                        mUpdateQuestion({
                          data: { questionId: q.id, patch: { required: e.target.checked } },
                        }),
                      ).then(refresh)
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("teach.quizzes.question.delete")}
                    onClick={() =>
                      run(() => mDeleteQuestion({ data: { questionId: q.id } })).then(refresh)
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {q.type === "single_choice" || q.type === "multi_choice" ? (
                <ul className="flex flex-col gap-2 pl-2">
                  {q.options.map((o) => (
                    <li key={o.id} className="flex items-center gap-2">
                      <input
                        type={q.type === "single_choice" ? "radio" : "checkbox"}
                        name={`correct-${q.id}`}
                        aria-label={t("teach.quizzes.option.correct")}
                        defaultChecked={o.isCorrect}
                        className="size-4 accent-primary"
                        onChange={(e) =>
                          run(() =>
                            mUpdateOption({
                              data: { optionId: o.id, patch: { isCorrect: e.target.checked } },
                            }),
                          ).then(refresh)
                        }
                      />
                      <Input
                        aria-label={t("teach.quizzes.option.label")}
                        defaultValue={o.label}
                        className="max-w-md"
                        onBlur={(e) =>
                          e.target.value !== o.label &&
                          run(() =>
                            mUpdateOption({
                              data: { optionId: o.id, patch: { label: e.target.value } },
                            }),
                          ).then(refresh)
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("teach.quizzes.option.delete")}
                        onClick={() =>
                          run(() => mDeleteOption({ data: { optionId: o.id } })).then(refresh)
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                  <li>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        run(() => mCreateOption({ data: { questionId: q.id } })).then(refresh)
                      }
                    >
                      <Plus aria-hidden="true" />
                      {t("teach.quizzes.option.add")}
                    </Button>
                  </li>
                </ul>
              ) : null}
            </div>
          )}
        />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(() =>
              mCreateQuestion({ data: { quizId: quiz.id, type: newType, promptMd: "…" } }),
            );
            await refresh();
          }}
        >
          <Field label={t("teach.quizzes.question.add")}>
            {(c) => (
              <Select
                {...c}
                value={newType}
                onChange={(e) => setNewType(e.target.value as QuestionType)}
                className="w-56"
              >
                {QUESTION_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`teach.quizzes.question.type.${ty}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="outline">
            <Plus aria-hidden="true" />
            {t("common.add")}
          </Button>
        </form>
      </section>

      <div className="border-t pt-6">
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden="true" />
          {t("teach.quizzes.delete")}
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        title={t("teach.quizzes.delete")}
        description={t("teach.quizzes.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await run(() => mDeleteQuiz({ data: { quizId: quiz.id } }));
          await navigate({
            to: "/teach/courses/$courseSlug/quizzes",
            params: { courseSlug: course.slug },
          });
        }}
      />
    </div>
  );
}

function QuestionPrompt({ initial, onSave }: { initial: string; onSave: (md: string) => void }) {
  const { t } = useI18n();
  const [md, setMd] = useState(initial);
  return (
    <Field label={t("teach.quizzes.question.prompt")}>
      {(c) => (
        <Input
          {...c}
          value={md}
          onChange={(e) => setMd(e.target.value)}
          onBlur={() => md.trim() && md !== initial && onSave(md)}
        />
      )}
    </Field>
  );
}
