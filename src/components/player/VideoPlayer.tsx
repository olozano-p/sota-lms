import { useEffect, useRef } from "react";

interface VideoPlayerProps {
  provider: string;
  iframeSrc: string;
  title: string;
  startAt: number | null;
  /** Called at most every ~10 s and on pause with the current position and duration. */
  onProgress: (positionS: number, durationS: number | null) => void;
  /** Called once when playback passes 90 % or ends. */
  onWatched: () => void;
}

const SAVE_EVERY_MS = 10_000;
const WATCHED_RATIO = 0.9;

/**
 * Provider iframe with a common event surface (timeupdate/pause/ended). The Vimeo adapter uses
 * @vimeo/player; another provider adds a branch here and nothing else changes.
 */
export function VideoPlayer({
  provider,
  iframeSrc,
  title,
  startAt,
  onProgress,
  onWatched,
}: VideoPlayerProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastSave = useRef(0);
  const watched = useRef(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || provider !== "vimeo") return;
    let disposed = false;
    let player: import("@vimeo/player").default | null = null;
    import("@vimeo/player").then(({ default: Player }) => {
      if (disposed) return;
      player = new Player(frame);
      let duration: number | null = null;
      player
        .getDuration()
        .then((d) => (duration = d))
        .catch(() => {});
      if (startAt && startAt > 5) player.setCurrentTime(startAt).catch(() => {});
      const consider = (seconds: number, force: boolean) => {
        const now = Date.now();
        if (force || now - lastSave.current >= SAVE_EVERY_MS) {
          lastSave.current = now;
          onProgress(seconds, duration);
        }
        if (!watched.current && duration && seconds / duration >= WATCHED_RATIO) {
          watched.current = true;
          onWatched();
        }
      };
      player.on("timeupdate", (e: { seconds: number; duration: number }) => {
        duration = e.duration;
        consider(e.seconds, false);
      });
      player.on("pause", (e: { seconds: number }) => consider(e.seconds, true));
      player.on("ended", (e: { seconds: number }) => {
        consider(e.seconds, true);
        if (!watched.current) {
          watched.current = true;
          onWatched();
        }
      });
    });
    return () => {
      disposed = true;
      player?.unload().catch(() => {});
    };
  }, [provider, iframeSrc, startAt, onProgress, onWatched]);

  return (
    <div className="overflow-hidden rounded-lg border bg-foreground/95">
      <iframe
        ref={frameRef}
        src={iframeSrc}
        title={title}
        className="aspect-video w-full"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
