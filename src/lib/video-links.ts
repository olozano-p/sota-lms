/**
 * Recognises a YouTube or Vimeo page URL and turns it into the privacy-friendly embed URL the
 * player iframe uses. Pure: shared by the editor (paste a link → embed node) and by the Markdown
 * renderer (a bare link on its own line → iframe). Anything else, including `javascript:`, is
 * rejected, so the iframe `src` is always built here and never copied from user input.
 */

export type VideoProviderId = "youtube" | "vimeo";

export interface VideoLink {
  provider: VideoProviderId;
  id: string;
  /** Vimeo unlisted videos carry a hash after the id. */
  hash: string | null;
  /** Canonical page URL, what gets written back to Markdown. */
  url: string;
  /** What the iframe loads. */
  embedSrc: string;
}

/** Hosts an embed may point at; a deployment keeps them in `embedAllowlist` for the CSP. */
export const VIDEO_EMBED_HOSTS = ["www.youtube-nocookie.com", "player.vimeo.com"] as const;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,12}$/i;

function youtube(id: string): VideoLink | null {
  if (!YOUTUBE_ID.test(id)) return null;
  return {
    provider: "youtube",
    id,
    hash: null,
    url: `https://www.youtube.com/watch?v=${id}`,
    embedSrc: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
  };
}

function vimeo(id: string, hash: string | null): VideoLink | null {
  if (!VIMEO_ID.test(id)) return null;
  const h = hash && VIMEO_HASH.test(hash) ? hash : null;
  return {
    provider: "vimeo",
    id,
    hash: h,
    url: h ? `https://vimeo.com/${id}/${h}` : `https://vimeo.com/${id}`,
    embedSrc: `https://player.vimeo.com/video/${id}?dnt=1&title=0&byline=0&portrait=0${h ? `&h=${h}` : ""}`,
  };
}

/**
 * `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID`,
 * `youtube-nocookie.com/embed/ID`, `vimeo.com/ID`, `vimeo.com/ID/HASH`, `player.vimeo.com/video/ID`.
 */
export function parseVideoUrl(input: string): VideoLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return parts[0] ? youtube(parts[0]) : null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v) return youtube(v);
    if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1])
      return youtube(parts[1]);
    return null;
  }
  if (host === "vimeo.com") {
    const idx = parts.findIndex((p) => VIMEO_ID.test(p));
    if (idx === -1) return null;
    return vimeo(parts[idx]!, parts[idx + 1] ?? url.searchParams.get("h"));
  }
  if (host === "player.vimeo.com") {
    if (parts[0] !== "video" || !parts[1]) return null;
    return vimeo(parts[1], url.searchParams.get("h"));
  }
  return null;
}

/** True when the whole line is nothing but a recognised video URL. */
export function isVideoLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed) && parseVideoUrl(trimmed) !== null;
}
