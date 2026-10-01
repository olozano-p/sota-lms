import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import { useI18n } from "~/i18n";
import { getLesson } from "~/server/queries/lessons";
import { saveProgress, setLessonCompleted } from "~/server/mutations/progress";
import { Blocks } from "~/components/player/Blocks";
import { LockNotice } from "~/components/LockNotice";
import { Slot } from "~/components/theme/Slot";
import { Button, buttonVariants } from "~/components/ui/button";
import { ProgressRule } from "~/components/ui/progress-rule";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/courses/$courseSlug_/$lessonSlug")({
  loader: async ({ params }) => {
    const data = await getLesson({
      data: { courseSlug: params.courseSlug, lessonSlug: params.lessonSlug },
    });
    if (!data) throw notFound();
    return data;
  },
  component: LessonPage,
});

function LessonPage() {
  const data = Route.useLoaderData();
  // Keyed by lesson so per-lesson state resets on navigation without effects.
  return <LessonView key={data.lesson.id} data={data} />;
}

function LessonView({ data }: { data: NonNullable<Awaited<ReturnType<typeof getLesson>>> }) {
  const { t } = useI18n();
  const { course, chapter, lesson, decision, blocks, mediaOnly, prev, next, position, privileged } =
    data;
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveProgress);
  const complete = useServerFn(setLessonCompleted);
  const [completed, setCompleted] = useState(data.progress?.status === "completed");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // Opening an accessible lesson marks it started (once per visit).
  useEffect(() => {
    if (!decision.ok || privileged || started.current || data.progress) return;
    started.current = true;
    save({ data: { lessonId: lesson.id } }).catch(() => {});
  }, [decision.ok, privileged, lesson.id, data.progress, save]);

  const onMediaProgress = useCallback(
    (positionS: number) => {
      if (privileged) return;
      save({ data: { lessonId: lesson.id, mediaPositionS: Math.floor(positionS) } }).catch(
        () => {},
      );
    },
    [lesson.id, privileged, save],
  );

  const setDone = useCallback(
    async (value: boolean) => {
      if (privileged) return;
      setBusy(true);
      try {
        await complete({ data: { lessonId: lesson.id, completed: value } });
        setCompleted(value);
        await router.invalidate();
      } finally {
        setBusy(false);
      }
    },
    [complete, lesson.id, privileged, router],
  );

  const onMediaWatched = useCallback(() => {
    if (mediaOnly && !completed) void setDone(true);
  }, [mediaOnly, completed, setDone]);

  // ←/→ switch lessons unless the focus is in a form control or a media player.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT", "AUDIO", "VIDEO", "IFRAME"].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft" && prev)
        navigate({
          to: "/courses/$courseSlug/$lessonSlug",
          params: { courseSlug: course.slug, lessonSlug: prev.slug },
        });
      if (e.key === "ArrowRight" && next)
        navigate({
          to: "/courses/$courseSlug/$lessonSlug",
          params: { courseSlug: course.slug, lessonSlug: next.slug },
        });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, course.slug, navigate]);

  return (
    <Slot
      name="LessonLayout"
      course={{ slug: course.slug, title: course.title }}
      chapter={{ title: chapter.title }}
      lesson={{ title: lesson.title, summary: lesson.summary }}
      position={position}
      draftPreview={privileged && lesson.status === "draft"}
      footer={
        <>
          {decision.ok && !privileged ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-6">
              {completed ? (
                <>
                  <span className="inline-flex items-center gap-2 text-sm text-success-foreground">
                    <Check className="size-4" aria-hidden="true" />
                    {t("lesson.done")}
                  </span>
                  <Button variant="ghost" size="sm" loading={busy} onClick={() => setDone(false)}>
                    {t("lesson.markUndone")}
                  </Button>
                </>
              ) : (
                <Button variant="outline" loading={busy} onClick={() => setDone(true)}>
                  <Check aria-hidden="true" />
                  {t("lesson.markDone")}
                </Button>
              )}
            </div>
          ) : null}
          <footer className="fixed inset-x-0 bottom-0 z-10 border-t bg-background">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
              {prev ? (
                <Link
                  to="/courses/$courseSlug/$lessonSlug"
                  params={{ courseSlug: course.slug, lessonSlug: prev.slug }}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "max-w-[40%] text-foreground no-underline hover:no-underline",
                  )}
                  title={prev.title}
                >
                  <ArrowLeft aria-hidden="true" />
                  <span className="truncate">{t("lesson.previous")}</span>
                </Link>
              ) : (
                <span />
              )}
              <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <ProgressRule
                  value={position.index / position.total}
                  label={t("lesson.position", { index: position.index, total: position.total })}
                  className="max-w-48"
                />
                <span
                  className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground"
                  title={t("lesson.keyboardHint")}
                >
                  {t("lesson.position", { index: position.index, total: position.total })}
                </span>
              </div>
              {next ? (
                <Link
                  to="/courses/$courseSlug/$lessonSlug"
                  params={{ courseSlug: course.slug, lessonSlug: next.slug }}
                  className={cn(
                    buttonVariants({ variant: next.locked ? "ghost" : "default", size: "sm" }),
                    "max-w-[40%] no-underline hover:no-underline",
                    next.locked ? "text-muted-foreground" : "text-primary-foreground",
                  )}
                  title={next.locked ? t("lesson.nextLocked") : next.title}
                >
                  <span className="truncate">{t("lesson.next")}</span>
                  {next.locked ? <Lock aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                </Link>
              ) : (
                <Link
                  to="/courses/$courseSlug"
                  params={{ courseSlug: course.slug }}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "max-w-[40%] text-foreground no-underline hover:no-underline",
                  )}
                  title={t("lesson.finished")}
                >
                  <span className="truncate">{t("lesson.backToCourse")}</span>
                </Link>
              )}
            </div>
          </footer>
        </>
      }
    >
      {decision.ok && blocks ? (
        <Blocks
          blocks={blocks}
          mediaPositionS={data.progress?.mediaPositionS ?? null}
          onMediaProgress={onMediaProgress}
          onMediaWatched={onMediaWatched}
        />
      ) : (
        <LockNotice decision={decision} />
      )}
    </Slot>
  );
}
