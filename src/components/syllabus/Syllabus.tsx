import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/cn";
import { lockMessage } from "~/components/LockNotice";
import type { SyllabusLesson } from "~/server/queries/courses";

export interface SyllabusChapter {
  id: string;
  title: string;
  /** Every lesson in it is closed to this person. */
  locked: boolean;
  /** When it opens, if every lesson waits for a release. */
  availableAt: Date | null;
  lessons: SyllabusLesson[];
}

interface SyllabusProps {
  courseSlug: string;
  chapters: SyllabusChapter[];
  /** The lesson on screen; its chapter opens and its row is marked current. */
  currentLessonSlug?: string;
  /** The course page itself is on screen: the «Welcome» row is current. */
  welcomeCurrent?: boolean;
  /** Chapter to open when no lesson is on screen (the one to continue in). */
  openChapterId?: string | null;
  forumEnabled?: boolean;
}

const row =
  "flex w-full items-center gap-3 rounded text-left font-serif text-sm leading-[1.2] text-foreground no-underline transition-colors duration-[120ms] ease-(--ease) hover:bg-background/60 hover:no-underline";

/**
 * The syllabus panel beside every course page: «Welcome», the chapters as collapsible rows and,
 * when on, the forum. A closed chapter is faded and says when it opens; lesson state is also a word
 * (title attribute and sr-only text), never fading alone.
 */
export function Syllabus({
  courseSlug,
  chapters,
  currentLessonSlug,
  welcomeCurrent = false,
  openChapterId,
  forumEnabled = false,
}: SyllabusProps) {
  const i18n = useI18n();
  const { t, fmtDayMonth } = i18n;
  const currentChapter = chapters.find((ch) =>
    ch.lessons.some((l) => l.slug === currentLessonSlug),
  )?.id;
  // The chapter in hand is open unless the reader closed it; any other is closed unless opened.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const inHand = currentChapter ?? openChapterId ?? chapters[0]?.id;
  const isOpen = (id: string) => toggled.get(id) ?? id === inHand;

  const thisYear = new Date().getFullYear();
  const releaseLabel = (d: Date) =>
    d.getFullYear() === thisYear ? fmtDayMonth(d) : `${fmtDayMonth(d)} ${d.getFullYear()}`;

  return (
    <nav aria-label={t("syllabus.title")} className="flex flex-col rounded-lg bg-card p-2">
      <Link
        to="/courses/$courseSlug"
        params={{ courseSlug }}
        aria-current={welcomeCurrent ? "page" : undefined}
        className={cn(row, "py-3.5 pr-4 pl-12", welcomeCurrent && "bg-background")}
      >
        {t("syllabus.welcome")}
      </Link>
      {chapters.map((ch) => {
        const expanded = isOpen(ch.id);
        const panelId = `chapter-${ch.id}`;
        return (
          <section key={ch.id} className="flex flex-col">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setToggled((m) => new Map(m).set(ch.id, !expanded))}
              className={cn(row, "p-4")}
            >
              <span className={cn("min-w-0 flex-1", ch.locked && "opacity-40")}>{ch.title}</span>
              {ch.availableAt ? (
                <span className="label shrink-0 text-muted-foreground">
                  <span className="sr-only">{t("syllabus.opensOn")} </span>
                  {releaseLabel(ch.availableAt)}
                </span>
              ) : null}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 transition-transform duration-[120ms] ease-(--ease)",
                  expanded && "rotate-180",
                )}
              />
            </button>
            <ol id={panelId} hidden={!expanded} className="flex flex-col">
              {ch.lessons.map((l) => {
                const locked = !l.decision.ok;
                const current = l.slug === currentLessonSlug;
                const stateLabel =
                  l.progress === "completed"
                    ? t("syllabus.done")
                    : locked
                      ? (lockMessage(l.decision, i18n) ?? t("syllabus.locked"))
                      : l.progress === "started"
                        ? t("syllabus.started")
                        : t("syllabus.todo");
                return (
                  <li key={l.id}>
                    <Link
                      to="/courses/$courseSlug/$lessonSlug"
                      params={{ courseSlug, lessonSlug: l.slug }}
                      aria-current={current ? "page" : undefined}
                      title={stateLabel}
                      className={cn(row, "py-3.5 pr-4 pl-12", current && "bg-background")}
                    >
                      <span className={cn("min-w-0 flex-1", locked && "opacity-40")}>
                        {l.title}
                        {l.status === "draft" ? (
                          <span className="label ml-2 text-muted-foreground">
                            {t("syllabus.draft")}
                          </span>
                        ) : null}
                      </span>
                      {l.progress === "completed" ? (
                        <Check className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                      ) : null}
                      <span className="sr-only">{stateLabel}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {forumEnabled ? (
        <Link
          to="/courses/$courseSlug/forum"
          params={{ courseSlug }}
          className={cn(row, "p-4 [&.active]:bg-background")}
        >
          {t("courses.tabs.forum")}
        </Link>
      ) : null}
    </nav>
  );
}
