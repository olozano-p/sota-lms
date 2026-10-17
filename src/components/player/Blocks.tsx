import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ClipboardList,
  ExternalLink,
  File,
  FileText,
  Film,
  Headphones,
  Image,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "~/i18n";
import type { ResolvedBlock } from "~/server/services/blocks";
import { buttonVariants } from "~/components/ui/button";
import { Markdown } from "./Markdown";
import { VideoPlayer } from "./VideoPlayer";
import { AudioPlayer } from "./AudioPlayer";

interface BlocksProps {
  blocks: ResolvedBlock[];
  /** The block that resumes at `mediaPositionS`: one saved position per lesson. */
  resumeBlockId: string | null;
  mediaPositionS: number | null;
  onMediaProgress: (positionS: number, durationS: number | null) => void;
  onMediaWatched: () => void;
}

type Group = "materials" | "audio" | "activities";

const groupOf = (b: ResolvedBlock): Group | null =>
  b.type === "file"
    ? "materials"
    : b.type === "audio"
      ? "audio"
      : b.type === "assignment" || b.type === "quiz"
        ? "activities"
        : null;

/** Consecutive files, audios and activities read as one labelled list, like the panels. */
function grouped(blocks: ResolvedBlock[]) {
  const out: { group: Group | null; blocks: ResolvedBlock[] }[] = [];
  for (const b of blocks) {
    const g = groupOf(b);
    const last = out.at(-1);
    if (g && last?.group === g) last.blocks.push(b);
    else out.push({ group: g, blocks: [b] });
  }
  return out;
}

const fileIcon = (mime: string): LucideIcon =>
  mime === "application/pdf" || mime.startsWith("text/")
    ? FileText
    : mime.startsWith("image/")
      ? Image
      : mime.startsWith("audio/")
        ? Headphones
        : mime.startsWith("video/")
          ? Film
          : File;

/** Icon plus an underlined label: a material, an assignment or a quiz. */
function Resource({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </li>
  );
}

export function Blocks({
  blocks,
  resumeBlockId,
  mediaPositionS,
  onMediaProgress,
  onMediaWatched,
}: BlocksProps) {
  const { t } = useI18n();
  const link = buttonVariants({ variant: "link" });
  const one = (b: ResolvedBlock) => {
    switch (b.type) {
      case "text":
        return <Markdown key={b.id} html={b.html} />;
      case "video":
        return (
          <figure key={b.id}>
            <VideoPlayer
              provider={b.provider}
              iframeSrc={b.iframeSrc}
              title={t("lesson.video.title", { title: b.title })}
              startAt={b.id === resumeBlockId ? mediaPositionS : null}
              onProgress={onMediaProgress}
              onWatched={onMediaWatched}
            />
          </figure>
        );
      case "audio":
        return (
          <li key={b.id}>
            <AudioPlayer
              url={b.url}
              title={b.title}
              durationS={b.durationS}
              startAt={b.id === resumeBlockId ? mediaPositionS : null}
              onProgress={onMediaProgress}
              onWatched={onMediaWatched}
            />
          </li>
        );
      case "file":
        return (
          <Resource key={b.id} icon={fileIcon(b.mime)}>
            {b.url ? (
              <a href={b.url} className={link}>
                <span className="sr-only">{t("lesson.download")}: </span>
                {b.title}
              </a>
            ) : (
              <span className="label text-muted-foreground">
                {b.title} · {t("lesson.fileMissing")}
              </span>
            )}
            <span className="label text-muted-foreground tabular-nums">
              {t("lesson.size", { n: (b.size / 1_048_576).toFixed(1) })}
            </span>
          </Resource>
        );
      case "embed":
        return b.allowed ? (
          <figure key={b.id} className="flex max-w-3xl flex-col gap-3">
            <iframe
              src={b.url}
              title={b.title ?? b.url}
              className="aspect-[4/3] w-full rounded-lg bg-card"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              loading="lazy"
            />
            <figcaption className="flex items-center gap-3">
              {b.title ? <span className="font-serif text-sm">{b.title}</span> : null}
              <a href={b.url} target="_blank" rel="noreferrer noopener" className={link}>
                {t("lesson.embedOpen")} <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </figcaption>
          </figure>
        ) : (
          <p key={b.id} className="rounded-lg bg-tint/40 p-4 font-serif text-sm">
            {t("lesson.embedBlocked")}
          </p>
        );
      case "assignment":
        return (
          <Resource key={b.id} icon={ClipboardList}>
            <Link
              to="/assignments/$assignmentId"
              params={{ assignmentId: b.assignmentId }}
              className={link}
            >
              {t("lesson.assignment.open")}: {b.title}
            </Link>
          </Resource>
        );
      case "quiz":
        return (
          <Resource key={b.id} icon={ListChecks}>
            <Link to="/quizzes/$quizId" params={{ quizId: b.quizId }} className={link}>
              {b.kind === "form" ? t("lesson.form.open") : t("lesson.quiz.open")}: {b.title}
            </Link>
          </Resource>
        );
    }
  };

  return (
    <div className="flex flex-col gap-10">
      {grouped(blocks).map(({ group, blocks: bs }) =>
        group ? (
          <section
            key={bs[0]!.id}
            aria-labelledby={`group-${bs[0]!.id}`}
            className="flex flex-col gap-4"
          >
            <h2 id={`group-${bs[0]!.id}`} className="label text-muted-foreground">
              {t(`lesson.group.${group}`)}
            </h2>
            <ul className="flex flex-col gap-3">{bs.map(one)}</ul>
          </section>
        ) : (
          one(bs[0]!)
        ),
      )}
    </div>
  );
}
