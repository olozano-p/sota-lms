import { Link } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/cn";
import { lockMessage } from "~/components/LockNotice";
import { Eyebrow } from "~/components/ui/eyebrow";
import type { SyllabusLesson } from "~/server/queries/courses";

interface SyllabusProps {
  courseSlug: string;
  chapters: { id: string; title: string; lessons: SyllabusLesson[] }[];
  currentLessonSlug?: string;
  compact?: boolean;
}

/**
 * The syllabus rail: chapters as eyebrows, lessons as rows with a glyph column joined by a thin
 * vertical rule. State is always also a word (title attribute / sr-only), never colour alone.
 */
export function Syllabus({
  courseSlug,
  chapters,
  currentLessonSlug,
  compact = false,
}: SyllabusProps) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <nav aria-label={t("syllabus.title")} className="flex flex-col gap-6">
      {chapters.map((ch, ci) => (
        <section key={ch.id} className="flex flex-col gap-2">
          <Eyebrow>
            <span className="tabular-nums">{ci + 1}</span> · {ch.title}
          </Eyebrow>
          <ol className="relative ml-2 flex flex-col border-l">
            {ch.lessons.map((l) => {
              const locked = !l.decision.ok;
              const current = l.slug === currentLessonSlug;
              const state =
                l.progress === "completed"
                  ? "done"
                  : locked
                    ? "locked"
                    : l.progress === "started"
                      ? "started"
                      : "todo";
              const stateLabel =
                state === "done"
                  ? t("syllabus.done")
                  : state === "locked"
                    ? (lockMessage(l.decision, i18n) ?? t("syllabus.locked"))
                    : state === "started"
                      ? t("syllabus.started")
                      : t("syllabus.todo");
              return (
                <li key={l.id} className="relative">
                  <Link
                    to="/courses/$courseSlug/$lessonSlug"
                    params={{ courseSlug, lessonSlug: l.slug }}
                    aria-current={current ? "page" : undefined}
                    title={stateLabel}
                    className={cn(
                      "-ml-px flex items-start gap-3 border-l-2 py-2 pl-4 pr-2 text-sm text-foreground no-underline transition-colors duration-[120ms] ease-(--ease) hover:bg-accent hover:no-underline",
                      current ? "border-primary bg-accent" : "border-transparent",
                      locked && "text-muted-foreground",
                    )}
                  >
                    <span
                      className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
                      aria-hidden="true"
                    >
                      {state === "done" ? (
                        <Check className="size-4 text-primary" />
                      ) : state === "locked" ? (
                        <Lock className="size-3.5" />
                      ) : (
                        <span
                          className={cn(
                            "size-2 rounded-full border",
                            state === "started"
                              ? "border-primary bg-primary"
                              : "border-muted-foreground/60",
                          )}
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("leading-snug", current && "font-medium")}>
                        {l.title}
                      </span>
                      {!compact && (l.summary || l.estimatedMinutes || l.status === "draft") ? (
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          {l.status === "draft" ? <span>{t("syllabus.draft")}</span> : null}
                          {l.estimatedMinutes ? (
                            <span className="tabular-nums">
                              {t("syllabus.minutes", { n: l.estimatedMinutes })}
                            </span>
                          ) : null}
                          {locked ? (
                            <span>{stateLabel}</span>
                          ) : l.summary ? (
                            <span>{l.summary}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="sr-only">{stateLabel}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </nav>
  );
}
