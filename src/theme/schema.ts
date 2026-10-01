/**
 * Shape of `theme.json` (docs/theming.md). Plain-Node safe: no alias imports. The same builder
 * yields the schema of one file (every field optional, so a theme may be partial) and the schema
 * of the merged result (every field present, defaults come from `default/theme.json`).
 *
 * Every string that ends up inside generated CSS is checked against a narrow grammar here, so a
 * theme can restyle the app but a typo (or a hostile value) cannot break out of a declaration.
 */
import { z } from "zod";
import { LOCALE_CODES } from "../config/schema.ts";

export const SLOT_NAMES = [
  "Header",
  "Footer",
  "LoginPage",
  "Home",
  "CourseCard",
  "LessonLayout",
  "EmptyState",
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** `emails/<name>.html` may exist for each of these; `layout` is the shared default. */
export const EMAIL_TEMPLATE_NAMES = [
  "layout",
  "submission_received",
  "feedback_returned",
  "chapter_released",
  "forum_reply",
  "forum_thread",
  "auth_magic_link",
  "auth_verify_email",
  "auth_reset_password",
  "auth_invite",
  "digest",
] as const;
export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

/** Colour tokens a theme may set, per mode; the value is the CSS custom property it becomes. */
export const COLOR_VARS = {
  ink: "--ink",
  paper: "--paper",
  primary: "--brand-primary",
  primaryForeground: "--brand-primary-foreground",
  link: "--brand-link",
  success: "--success",
  successForeground: "--success-foreground",
  warning: "--warning",
  warningForeground: "--warning-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  info: "--info",
  infoForeground: "--info-foreground",
  // Derived from ink and paper in styles.css unless a theme sets them.
  card: "--card",
  popover: "--popover",
  mutedForeground: "--muted-foreground",
  border: "--border",
  input: "--input",
  muted: "--muted",
  accent: "--accent",
  secondary: "--secondary",
  code: "--code",
  ring: "--ring",
} as const;
export type ColorKey = keyof typeof COLOR_VARS;
/** Keys a theme must supply (via the shipped default) because nothing can derive them. */
const BASE_COLOR_KEYS = [
  "ink",
  "paper",
  "primary",
  "primaryForeground",
  "link",
  "success",
  "successForeground",
  "warning",
  "warningForeground",
  "destructive",
  "destructiveForeground",
  "info",
  "infoForeground",
] as const satisfies readonly ColorKey[];

const COLOR_RE =
  /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z%.,\s/+-]{3,80}\))$/i;
const LENGTH_RE = /^(0|\d*\.?\d+(px|rem|em|ch|vw|vh|%))$/;
const FONT_STACK_RE = /^[\w\s"',.-]+$/;
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/;

const color = z.string().regex(COLOR_RE, "expected a hex, rgb(), hsl() or oklch() colour");
const length = z.string().regex(LENGTH_RE, "expected a CSS length such as 0.25rem, 72rem or 68ch");
const fontStack = z
  .string()
  .min(1)
  .max(300)
  .regex(FONT_STACK_RE, "expected a font-family list: names, quotes and commas only")
  .refine(
    (s) => (s.match(/"/g)?.length ?? 0) % 2 === 0 && (s.match(/'/g)?.length ?? 0) % 2 === 0,
    "unbalanced quotes",
  );

/** A path inside `assets/`: POSIX, relative, no `..`, no hidden segments. */
export const assetPath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (p) => p.split("/").every((s) => SEGMENT_RE.test(s) && s !== ".."),
    "expected a relative path inside assets/ (no .., no leading dots, no backslashes)",
  );

const assetRef = z.union([assetPath, z.url({ protocol: /^https$/ })]);

const localized = z.union([
  z.string().min(1),
  z.strictObject({
    ca: z.string().min(1).optional(),
    es: z.string().min(1).optional(),
    en: z.string().min(1).optional(),
  }),
]);
export type LocalizedText = z.infer<typeof localized>;

const href = z
  .string()
  .max(500)
  .refine(
    (v) => /^(https?:\/\/|mailto:)\S+$/i.test(v) || /^\/(?!\/)\S*$/.test(v),
    "expected an https:// URL, a mailto: link or a path starting with /",
  );

const FONT_EXT = ["woff2", "woff", "ttf", "otf"] as const;

function themeShape(req: boolean) {
  const o = <T extends z.ZodType>(s: T) => (req ? s : s.optional());
  const palette = () =>
    z.strictObject(
      Object.fromEntries(
        (Object.keys(COLOR_VARS) as ColorKey[]).map((k) => [
          k,
          (BASE_COLOR_KEYS as readonly string[]).includes(k) ? o(color) : color.optional(),
        ]),
      ) as unknown as Record<ColorKey, z.ZodType<string | undefined>>,
    );
  return z.strictObject({
    name: o(z.string().min(1).max(80)),
    tagline: o(localized.nullable()),
    /** File inside `assets/`, or an https URL. Null: the built-in mark. */
    logo: o(assetRef.nullable()),
    favicon: o(assetRef.nullable()),
    defaultLocale: o(z.enum(LOCALE_CODES)),
    supportEmail: o(z.email().nullable()),
    /** Where "Made with SOTA" in the footer links; null: plain text. */
    projectUrl: o(z.url({ protocol: /^https?$/ }).nullable()),
    legalLinks: o(z.array(z.strictObject({ label: localized, href })).max(8)),
    colors: o(z.strictObject({ light: o(palette()), dark: o(palette()) })),
    fonts: o(
      z.strictObject({
        sans: o(fontStack),
        serif: o(fontStack),
        mono: o(fontStack),
        /** Self-hosted faces: files in `assets/`, declared as `@font-face` for you. */
        faces: o(
          z
            .array(
              z.strictObject({
                family: z
                  .string()
                  .min(1)
                  .max(60)
                  .regex(/^[\w\s-]+$/, "letters, digits, spaces and hyphens only"),
                file: assetPath.refine(
                  (f) =>
                    (FONT_EXT as readonly string[]).includes(f.split(".").pop()!.toLowerCase()),
                  `expected a ${FONT_EXT.join(", ")} file`,
                ),
                weight: z
                  .string()
                  .regex(/^\d{3}( \d{3})?$/, "expected 400 or a range such as 100 900")
                  .default("400"),
                style: z.enum(["normal", "italic"]).default("normal"),
              }),
            )
            .max(24),
        ),
      }),
    ),
    radius: o(z.strictObject({ control: o(length), surface: o(length) })),
    spacing: o(
      z.strictObject({
        /** Tailwind's base unit: every `p-4`, `gap-6`… is a multiple of it. */
        unit: o(length),
        /** Width of the page column (header, content, footer). */
        contentWidth: o(length),
        /** Measure of lesson prose. */
        proseWidth: o(length),
      }),
    ),
  });
}

export const themeInputSchema = themeShape(false);
export const themeSchema = themeShape(true);

export type ThemeInput = z.infer<typeof themeInputSchema>;
/** A merged, validated theme: every field present (the shipped default supplies the rest). */
export interface ThemeConfig {
  name: string;
  tagline: LocalizedText | null;
  logo: string | null;
  favicon: string | null;
  defaultLocale: (typeof LOCALE_CODES)[number];
  supportEmail: string | null;
  projectUrl: string | null;
  legalLinks: { label: LocalizedText; href: string }[];
  colors: {
    light: Record<(typeof BASE_COLOR_KEYS)[number], string> & Partial<Record<ColorKey, string>>;
    dark: Record<(typeof BASE_COLOR_KEYS)[number], string> & Partial<Record<ColorKey, string>>;
  };
  fonts: {
    sans: string;
    serif: string;
    mono: string;
    faces: { family: string; file: string; weight: string; style: "normal" | "italic" }[];
  };
  radius: { control: string; surface: string };
  spacing: { unit: string; contentWidth: string; proseWidth: string };
}

/** Zod issues as one readable line each, with the dotted path of the offending field. */
export function formatIssues(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((i) => {
    const where = i.path.length ? i.path.join(".") : "(root)";
    return i.code === "unrecognized_keys"
      ? `${prefix}${where}: unknown key ${i.keys.map((k) => `"${k}"`).join(", ")}`
      : `${prefix}${where}: ${i.message}`;
  });
}
