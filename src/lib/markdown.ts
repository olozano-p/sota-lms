import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { isVideoLine, parseVideoUrl } from "./video-links";

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "code",
  "pre",
  "blockquote",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "sup",
  "sub",
  "span",
];
const ALLOWED_ATTR = ["href", "title", "alt", "src", "lang", "start", "align"];

/**
 * A YouTube or Vimeo link alone on its line becomes a player. The line is swapped for an inert
 * token before parsing (GFM would autolink it) and the iframe is written after sanitising, from
 * the parsed id only, so `iframe` never has to be an allowed tag for user content.
 */
const EMBED_TOKEN = "sota-embed-7f3a1c";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function liftVideoLines(md: string): { md: string; embeds: string[] } {
  const embeds: string[] = [];
  const lines = md.split("\n").map((line) => {
    if (!isVideoLine(line)) return line;
    const video = parseVideoUrl(line.trim());
    if (!video) return line;
    embeds.push(video.embedSrc);
    return `${EMBED_TOKEN}-${embeds.length - 1}`;
  });
  return { md: lines.join("\n"), embeds };
}

function placeEmbeds(html: string, embeds: string[]): string {
  if (!embeds.length) return html;
  return html.replace(new RegExp(`<p>${EMBED_TOKEN}-(\\d+)</p>`, "g"), (whole, n: string) => {
    const src = embeds[Number(n)];
    if (!src) return whole;
    return `<figure class="embed"><iframe src="${esc(src)}" title="" loading="lazy" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>`;
  });
}

/**
 * Markdown → sanitised HTML. Raw HTML in the source is dropped by the sanitiser; `h1` is demoted
 * to `h2` so a lesson never carries two page titles. Links open in the same tab (the reader is in
 * a lesson; the browser's back button is the way home).
 */
export function renderMarkdown(md: string): string {
  const lifted = liftVideoLines(md);
  const html = marked.parse(lifted.md, { async: false }).replace(/<(\/?)h1\b/g, "<$1h2");
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/))/i,
  });
  return placeEmbeds(clean, lifted.embeds);
}

/** First paragraph, plain text, for previews and email. */
export function markdownExcerpt(md: string, max = 160): string {
  const text = md
    .split("\n")
    .filter((line) => !isVideoLine(line))
    .join("\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*_`~[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
