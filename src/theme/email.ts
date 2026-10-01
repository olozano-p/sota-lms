/**
 * Transactional email layout: `{{name}}` is HTML-escaped, `{{{name}}}` is inserted as is (only for
 * markup this code built from escaped parts). Plain-Node safe.
 */
import type { ThemeConfig } from "./schema.ts";

/** Placeholders every email template may use (docs/theming.md). */
export const EMAIL_VARS = [
  "brand",
  "title",
  "lines",
  "ctaLabel",
  "ctaUrl",
  "tagline",
  "supportEmail",
  "color.ink",
  "color.paper",
  "color.muted",
  "color.border",
  "color.primary",
  "color.primaryForeground",
  "color.link",
  "font.sans",
  "font.serif",
] as const;

const PLACEHOLDER = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Names used by a template, with whether each is the raw (`{{{ }}}`) form. */
export function placeholdersOf(source: string): { name: string; raw: boolean }[] {
  return [...source.matchAll(PLACEHOLDER)].map((m) => ({ name: (m[1] ?? m[2])!, raw: !!m[1] }));
}

export function fillTemplate(source: string, vars: Record<string, string>): string {
  return source.replace(PLACEHOLDER, (_m, raw: string | undefined, esc: string | undefined) => {
    const name = (raw ?? esc)!;
    const value = vars[name] ?? "";
    return raw ? value : escapeHtml(value);
  });
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `ratio` of `a` over `b`, as a hex colour; `fallback` when either is not a plain hex. */
export function mixHex(a: string, b: string, ratio: number, fallback: string): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return fallback;
  const c = x.map((v, i) => Math.round(v * ratio + y[i]! * (1 - ratio)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The light palette as email clients need it: plain values, no CSS variables. */
export function emailPalette(theme: Pick<ThemeConfig, "colors" | "fonts">): Record<string, string> {
  const c = theme.colors.light;
  return {
    "color.ink": c.ink,
    "color.paper": c.paper,
    "color.muted": c.mutedForeground ?? mixHex(c.ink, c.paper, 0.65, c.ink),
    "color.border": c.border ?? mixHex(c.ink, c.paper, 0.12, "#dddddd"),
    "color.primary": c.primary,
    "color.primaryForeground": c.primaryForeground,
    "color.link": c.link,
    "font.sans": theme.fonts.sans,
    "font.serif": theme.fonts.serif,
  };
}
