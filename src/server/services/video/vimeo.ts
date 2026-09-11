import { env } from "~/config/env";
import type { VideoMetadata, VideoProvider } from "./provider";

const ID_PATTERN = /^\d{6,12}$/;

/** `https://vimeo.com/123456`, `https://vimeo.com/123456/abcdef` (unlisted), `https://player.vimeo.com/video/123456`, or a bare id. */
export function parseVimeoInput(input: string): { id: string; hash: string | null } | null {
  const trimmed = input.trim();
  if (ID_PATTERN.test(trimmed)) return { id: trimmed, hash: null };
  try {
    const url = new URL(trimmed);
    if (!/(^|\.)vimeo\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => ID_PATTERN.test(p));
    if (idx === -1) return null;
    const hash =
      parts[idx + 1] && /^[0-9a-f]{6,12}$/i.test(parts[idx + 1]!)
        ? parts[idx + 1]!
        : url.searchParams.get("h");
    return { id: parts[idx]!, hash };
  } catch {
    return null;
  }
}

export const vimeoProvider: VideoProvider = {
  id: "vimeo",

  async resolve(input): Promise<VideoMetadata> {
    const parsed = parseVimeoInput(input);
    if (!parsed) throw new Error("not a Vimeo URL or id");
    const external_id = parsed.hash ? `${parsed.id}:${parsed.hash}` : parsed.id;
    const token = env.vimeoAccessToken;
    if (!token)
      return { external_id, title: `Vimeo ${parsed.id}`, duration_s: null, thumbnail_url: null };
    const res = await fetch(
      `https://api.vimeo.com/videos/${parsed.id}?fields=name,duration,pictures.sizes`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.vimeo.*+json;version=3.4",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.status === 404) throw new Error("video not found in this Vimeo account");
    if (!res.ok) throw new Error(`Vimeo answered ${res.status}`);
    const data = (await res.json()) as {
      name?: string;
      duration?: number;
      pictures?: { sizes?: { width: number; link: string }[] };
    };
    const pic =
      data.pictures?.sizes?.sort((a, b) => b.width - a.width).find((s) => s.width <= 960) ??
      data.pictures?.sizes?.at(-1);
    return {
      external_id,
      title: data.name ?? `Vimeo ${parsed.id}`,
      duration_s: typeof data.duration === "number" ? data.duration : null,
      thumbnail_url: pic?.link ?? null,
    };
  },

  embed(externalId) {
    const [id, hash] = externalId.split(":");
    const params = new URLSearchParams({
      dnt: "1",
      title: "0",
      byline: "0",
      portrait: "0",
      pip: "1",
    });
    if (hash) params.set("h", hash);
    return {
      iframeSrc: `https://player.vimeo.com/video/${id}?${params}`,
      frameHost: "player.vimeo.com",
    };
  },
};
