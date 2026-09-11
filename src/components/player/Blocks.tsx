import { Link } from "@tanstack/react-router";
import { ClipboardList, Download, ExternalLink, FileText, ListChecks } from "lucide-react";
import { useI18n } from "~/i18n";
import type { ResolvedBlock } from "~/server/services/blocks";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import { Markdown } from "./Markdown";
import { VideoPlayer } from "./VideoPlayer";
import { AudioPlayer } from "./AudioPlayer";

interface BlocksProps {
  blocks: ResolvedBlock[];
  mediaPositionS: number | null;
  onMediaProgress: (positionS: number, durationS: number | null) => void;
  onMediaWatched: () => void;
}

export function Blocks({ blocks, mediaPositionS, onMediaProgress, onMediaWatched }: BlocksProps) {
  const { t } = useI18n();
  // Resume applies to the first media block only: one saved position per lesson.
  const firstMedia = blocks.find((b) => b.type === "video" || b.type === "audio")?.id;
  return (
    <div className="flex flex-col gap-8">
      {blocks.map((b) => {
        switch (b.type) {
          case "text":
            return <Markdown key={b.id} html={b.html} />;
          case "video":
            return (
              <figure key={b.id} className="flex flex-col gap-2">
                <VideoPlayer
                  provider={b.provider}
                  iframeSrc={b.iframeSrc}
                  title={t("lesson.video.title", { title: b.title })}
                  startAt={b.id === firstMedia ? mediaPositionS : null}
                  onProgress={onMediaProgress}
                  onWatched={onMediaWatched}
                />
                {b.title ? (
                  <figcaption className="text-sm text-muted-foreground">{b.title}</figcaption>
                ) : null}
              </figure>
            );
          case "audio":
            return (
              <AudioPlayer
                key={b.id}
                url={b.url}
                title={b.title}
                durationS={b.durationS}
                startAt={b.id === firstMedia ? mediaPositionS : null}
                onProgress={onMediaProgress}
                onWatched={onMediaWatched}
              />
            );
          case "file":
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{b.title}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {b.mime} · {t("lesson.size", { n: (b.size / 1_048_576).toFixed(1) })}
                    </p>
                  </div>
                </div>
                {b.url ? (
                  <a
                    href={b.url}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "text-foreground no-underline hover:no-underline",
                    )}
                  >
                    <Download aria-hidden="true" />
                    {t("lesson.download")}
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("lesson.fileMissing")}</span>
                )}
              </div>
            );
          case "embed":
            return b.allowed ? (
              <figure key={b.id} className="flex flex-col gap-2">
                <iframe
                  src={b.url}
                  title={b.title ?? b.url}
                  className="aspect-[4/3] w-full rounded-lg border bg-card"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  loading="lazy"
                />
                <figcaption className="flex items-center gap-2 text-sm text-muted-foreground">
                  {b.title ? <span>{b.title}</span> : null}
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1"
                  >
                    {t("lesson.embedOpen")} <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </figcaption>
              </figure>
            ) : (
              <p
                key={b.id}
                className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
              >
                {t("lesson.embedBlocked")}
              </p>
            );
          case "assignment":
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <ClipboardList className="size-5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.06em] text-muted-foreground">
                      {t("lesson.assignment.title")}
                    </p>
                    <p className="font-medium">{b.title}</p>
                  </div>
                </div>
                <Link
                  to="/assignments/$assignmentId"
                  params={{ assignmentId: b.assignmentId }}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "text-foreground no-underline hover:no-underline",
                  )}
                >
                  {t("lesson.assignment.open")}
                </Link>
              </div>
            );
          case "quiz":
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <ListChecks className="size-5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.06em] text-muted-foreground">
                      {b.kind === "form" ? t("lesson.form.title") : t("lesson.quiz.title")}
                    </p>
                    <p className="font-medium">{b.title}</p>
                  </div>
                </div>
                <Link
                  to="/quizzes/$quizId"
                  params={{ quizId: b.quizId }}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "text-foreground no-underline hover:no-underline",
                  )}
                >
                  {t("lesson.quiz.open")}
                </Link>
              </div>
            );
        }
      })}
    </div>
  );
}
