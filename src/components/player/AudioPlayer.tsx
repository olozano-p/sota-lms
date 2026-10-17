import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
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

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/**
 * One audio as a row: a round play button and «Title · 12 min»; once started, a seek bar with the
 * time. The `<audio>` element underneath does the playing, so progress saving and the 90 % rule
 * work as with native controls.
 */
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
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState<number | null>(durationS);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const restore = () => {
      if (Number.isFinite(el.duration)) setLength(el.duration);
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
    const onTime = () => {
      setTime(el.currentTime);
      consider(false);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      consider(true);
    };
    el.addEventListener("loadedmetadata", restore);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("loadedmetadata", restore);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, [startAt, onProgress, onWatched]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!url}
          aria-label={t(playing ? "lesson.audio.pause" : "lesson.audio.play", { title })}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tint text-foreground transition-colors duration-[120ms] ease-(--ease) hover:bg-tint/70 disabled:opacity-40 pointer-coarse:size-11"
        >
          {playing ? (
            <Pause className="size-2.5 fill-current" aria-hidden="true" />
          ) : (
            <Play className="size-2.5 translate-x-px fill-current" aria-hidden="true" />
          )}
        </button>
        <p className="font-serif text-sm leading-[1.2]">
          {title}
          {durationS ? <span className="tabular-nums"> · {fmtDuration(durationS)}</span> : null}
        </p>
      </div>
      {url ? (
        <audio
          ref={ref}
          preload="metadata"
          src={`${url}?inline=1`}
          className="hidden"
          aria-label={t("lesson.audio.title", { title })}
        />
      ) : (
        <p className="pl-9 font-serif text-sm text-muted-foreground">{t("lesson.fileMissing")}</p>
      )}
      {url && length && (playing || time > 0) ? (
        <div className="flex max-w-md items-center gap-3 pl-9">
          <input
            type="range"
            min={0}
            max={length}
            step={1}
            value={time}
            onChange={(e) => {
              const el = ref.current;
              if (el) el.currentTime = Number(e.target.value);
            }}
            aria-label={t("lesson.audio.seek", { title })}
            aria-valuetext={`${clock(time)} / ${clock(length)}`}
            className="h-1 flex-1 accent-primary"
          />
          <span className="label text-muted-foreground tabular-nums">
            {clock(time)} / {clock(length)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
