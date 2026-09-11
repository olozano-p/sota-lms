import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

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
 * Markdown → sanitised HTML. Raw HTML in the source is dropped by the sanitiser; `h1` is demoted
 * to `h2` so a lesson never carries two page titles. Links open in the same tab (the reader is in
 * a lesson; the browser's back button is the way home).
 */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }).replace(/<(\/?)h1\b/g, "<$1h2");
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/))/i,
  });
}

/** First paragraph, plain text, for previews and email. */
export function markdownExcerpt(md: string, max = 160): string {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
