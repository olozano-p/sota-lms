import { useEffect, useRef } from "react";
import { Music } from "lucide-react";
import { useI18n } from "~/i18n";

interface AudioPlayerProps {
  url: string | null;
  title: string;
  durationS: number | null;
  startAt: number | null;
  onProgress: (positionS: number, durationS: number | null) => void;
  onWatched: () => void;
}

const SAVE_EVERY_MS = 10_000;

/** Native `<audio>`: the browser supplies the controls, keyboard handling and accessibility. */
export function AudioPlayer({
  url,
  title,
  durationS,
  startAt,
  onProgress,
  onWatched,
}: AudioPlayerProps) {
  const { t, fmtDuration } = useI18n();
  const ref = useRef<HTMLAudioElement>(null);
  const lastSave = useRef(0);
  const watched = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const restore = () => {
      if (startAt && startAt > 5 && el.currentTime < 1) el.currentTime = startAt;
    };
    const consider = (force: boolean) => {
      const now = Date.now();
      if (force || now - lastSave.current >= SAVE_EVERY_MS) {
        lastSave.current = now;
        onProgress(el.currentTime, Number.isFinite(el.duration) ? el.duration : null);
      }
      if (
        !watched.current &&
        Number.isFinite(el.duration) &&
        el.duration > 0 &&
        el.currentTime / el.duration >= 0.9
      ) {
        watched.current = true;
        onWatched();
      }
    };
    const onTime = () => consider(false);
    const onPause = () => consider(true);
    el.addEventListener("loadedmetadata", restore);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("loadedmetadata", restore);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, [startAt, onProgress, onWatched]);

  return (
    <figure className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <figcaption className="flex items-center gap-2 text-sm">
        <Music className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{title}</span>
        {durationS ? (
          <span className="text-muted-foreground tabular-nums">· {fmtDuration(durationS)}</span>
        ) : null}
      </figcaption>
      {url ? (
        <audio
          ref={ref}
          controls
          preload="metadata"
          src={`${url}?inline=1`}
          className="w-full"
          aria-label={t("lesson.audio.title", { title })}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("lesson.fileMissing")}</p>
      )}
    </figure>
  );
}
