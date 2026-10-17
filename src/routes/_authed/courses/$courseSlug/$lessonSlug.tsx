import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import { useI18n } from "~/i18n";
import { getLesson } from "~/server/queries/lessons";
import { saveProgress, setLessonCompleted } from "~/server/mutations/progress";
import { Blocks } from "~/components/player/Blocks";
import { LockNotice } from "~/components/LockNotice";
import { Slot } from "~/components/theme/Slot";
import { Button, buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";

const frame = getRouteApi("/_authed/courses/$courseSlug");

export const Route = createFileRoute("/_authed/courses/$courseSlug/$lessonSlug")({
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
  const { t, fmtDuration } = useI18n();
  const { chapters, teachers } = frame.useLoaderData();
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

  // The opening video sits above the summary; everything else follows it.
  const media = decision.ok && blocks?.[0]?.type === "video" ? blocks[0] : null;
  const rest = media ? blocks!.slice(1) : (blocks ?? []);
  const resumeBlockId = blocks?.find((b) => b.type === "video" || b.type === "audio")?.id ?? null;
  const mediaS = (blocks ?? []).reduce(
    (n, b) => n + ((b.type === "video" || b.type === "audio" ? b.durationS : null) ?? 0),
    0,
  );
  const chapterIndex = chapters.findIndex((ch) => ch.slug === chapter.slug) + 1;
  const meta = [
    chapterIndex
      ? t("lesson.meta.position", { chapter: chapterIndex, lesson: position.index })
      : t("lesson.position", { index: position.index, total: position.total }),
    ...teachers,
    ...(lesson.estimatedMinutes
      ? [t("common.minutes", { n: lesson.estimatedMinutes })]
      : mediaS
        ? [fmtDuration(mediaS)]
        : []),
  ];
  const playerProps = {
    resumeBlockId,
    mediaPositionS: data.progress?.mediaPositionS ?? null,
    onMediaProgress,
    onMediaWatched,
  };
  const link = buttonVariants({ variant: "link" });

  return (
    <Slot
      name="LessonLayout"
      course={{ slug: course.slug, title: course.title }}
      chapter={{ title: chapter.title }}
      lesson={{ title: lesson.title, summary: lesson.summary }}
      position={position}
      meta={meta}
      draftPreview={privileged && lesson.status === "draft"}
      media={media ? <Blocks blocks={[media]} {...playerProps} /> : null}
      footer={
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-4"
          title={t("lesson.keyboardHint")}
        >
          {decision.ok && !privileged ? (
            completed ? (
              <>
                <span className="label inline-flex h-12 items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5" aria-hidden="true" />
                  {t("lesson.done")}
                </span>
                <Button variant="link" loading={busy} onClick={() => setDone(false)}>
                  {t("lesson.markUndone")}
                </Button>
              </>
            ) : (
              <Button loading={busy} onClick={() => setDone(true)}>
                <Check aria-hidden="true" />
                {t("lesson.markDone")}
              </Button>
            )
          ) : null}
          {prev ? (
            <Link
              to="/courses/$courseSlug/$lessonSlug"
              params={{ courseSlug: course.slug, lessonSlug: prev.slug }}
              className={link}
              title={prev.title}
            >
              <ArrowLeft aria-hidden="true" />
              {t("lesson.previous")}
            </Link>
          ) : null}
          {next ? (
            <Link
              to="/courses/$courseSlug/$lessonSlug"
              params={{ courseSlug: course.slug, lessonSlug: next.slug }}
              className={cn(link, next.locked && "text-muted-foreground")}
              title={next.locked ? t("lesson.nextLocked") : next.title}
            >
              {t("lesson.nextLesson")}
              {next.locked ? <Lock aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            </Link>
          ) : (
            <Link
              to="/courses/$courseSlug"
              params={{ courseSlug: course.slug }}
              className={link}
              title={t("lesson.finished")}
            >
              {t("lesson.backToCourse")}
            </Link>
          )}
        </div>
      }
    >
      {decision.ok && blocks ? (
        rest.length ? (
          <Blocks blocks={rest} {...playerProps} />
        ) : null
      ) : (
        <LockNotice decision={decision} />
      )}
    </Slot>
  );
}
