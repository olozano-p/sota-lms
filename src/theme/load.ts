/**
 * Loads and validates a theme directory (docs/theming.md, ADR-019): `theme.json`, `custom.css`,
 * `messages/<locale>.json`, `emails/*.html`, `assets/` and `slots/`, layered over the defaults
 * shipped in `src/theme/default`. Everything but the slots is read at runtime; slots are compiled
 * into the bundle (see `vite-plugin.ts`). Throws `ThemeError` listing every problem.
 * Plain-Node safe: relative imports with .ts extensions, no alias.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ca } from "../i18n/ca.ts";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { LOCALE_CODES, type LocaleCode } from "../config/schema.ts";
import { EMAIL_VARS, placeholdersOf } from "./email.ts";
import {
  COLOR_VARS,
  EMAIL_TEMPLATE_NAMES,
  SLOT_NAMES,
  formatIssues,
  themeInputSchema,
  themeSchema,
  type ColorKey,
  type LocalizedText,
  type SlotName,
  type ThemeConfig,
} from "./schema.ts";

/**
 * The shipped defaults. Next to this file when it runs from source; inside the Vite server bundle
 * `import.meta.url` points into `dist/`, so fall back to `src/theme/default` under the working
 * directory (the image keeps `src/theme` for exactly this).
 */
export const DEFAULT_THEME_DIR = (() => {
  const beside = join(dirname(fileURLToPath(import.meta.url)), "default");
  return existsSync(join(beside, "theme.json"))
    ? beside
    : join(process.cwd(), "src", "theme", "default");
})();

export class ThemeError extends Error {
  readonly problems: string[];
  constructor(dir: string, problems: string[]) {
    super(
      `Invalid theme in ${dir} (docs/theming.md; check it with \`pnpm sota validate-theme\`):\n${problems
        .map((p) => `  - ${p}`)
        .join("\n")}`,
    );
    this.name = "ThemeError";
    this.problems = problems;
  }
}

export type MessageOverrides = Record<LocaleCode, Record<string, string>>;

export interface LoadedTheme {
  dir: string;
  /** False when the directory is absent and only the shipped defaults apply. */
  exists: boolean;
  config: ThemeConfig;
  /** `:root` and `.dark` custom properties plus `@font-face` rules. */
  variablesCss: string;
  /** What `/theme/theme.css` serves: variables, font faces, then `custom.css` last. */
  css: string;
  cssHash: string;
  messages: MessageOverrides;
  emails: { layout: string; byName: Partial<Record<string, string>> };
  assetsDir: string;
  assets: string[];
  /** Slots with a file in `<dir>/slots` (compiled in at build time). */
  slots: SlotName[];
  /** Things that work but probably are not what the author meant. */
  warnings: string[];
}

const catalogs: Record<LocaleCode, Record<string, string>> = { ca, es, en };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Objects merge key by key; arrays and scalars from `over` replace those of `base`. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v);
  return out as T;
}

/** `{a: {b: "x"}}` and `{"a.b": "x"}` both become `{"a.b": "x"}`; non-strings are reported. */
export function flattenMessages(
  value: unknown,
  problems: string[],
  file: string,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(value)) {
    problems.push(`${file}: expected a JSON object`);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (isObject(v)) Object.assign(out, flattenMessages(v, problems, file, key));
    else problems.push(`${file}: "${key}" must be a string`);
  }
  return out;
}

function readJson(path: string, problems: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    problems.push(`${path}: ${(e as Error).message}`);
    return undefined;
  }
}

const placeholderSet = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));

function colorDecls(palette: Partial<Record<ColorKey, string | undefined>>): string {
  return (Object.keys(COLOR_VARS) as ColorKey[])
    .filter((k) => palette[k])
    .map((k) => `${COLOR_VARS[k]}:${palette[k]}`)
    .join(";");
}

/** The custom properties of a resolved theme (docs/DESIGN.md: tokens only). */
export function themeVariables(c: ThemeConfig): string {
  const root = [
    colorDecls(c.colors.light),
    `--font-sans:${c.fonts.sans}`,
    `--font-serif:${c.fonts.serif}`,
    `--font-mono:${c.fonts.mono}`,
    `--radius:${c.radius.control}`,
    `--radius-surface:${c.radius.surface}`,
    `--spacing:${c.spacing.unit}`,
    `--content-width:${c.spacing.contentWidth}`,
    `--measure:${c.spacing.proseWidth}`,
  ]
    .filter(Boolean)
    .join(";");
  const faces = c.fonts.faces
    .map((f) => {
      const ext = f.file.split(".").pop()!.toLowerCase();
      const format = ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : ext;
      return `@font-face{font-family:"${f.family}";src:url("${assetUrl(f.file)}") format("${format}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`;
    })
    .join("\n");
  return `:root{${root}}\n.dark{${colorDecls(c.colors.dark)}}${faces ? `\n${faces}` : ""}\n`;
}

/** Public URL of a file in `assets/`. */
export const assetUrl = (file: string) =>
  `/theme/assets/${file.split("/").map(encodeURIComponent).join("/")}`;

function listFiles(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(join(dir, e.name), `${base}${e.name}/`)
      : e.isFile() && !e.name.startsWith(".")
        ? [`${base}${e.name}`]
        : [],
  );
}

/** Validates one email template: known placeholders, and a link the reader can follow. */
function checkEmail(
  name: string,
  source: string,
  file: string,
  problems: string[],
  warnings: string[],
) {
  const known = new Set<string>(EMAIL_VARS);
  const used = placeholdersOf(source);
  for (const u of new Set(used.map((p) => p.name)))
    if (!known.has(u))
      problems.push(`${file}: unknown placeholder {{${u}}} (known: ${EMAIL_VARS.join(", ")})`);
  if (used.some((p) => p.name === "lines" && !p.raw))
    problems.push(`${file}: use {{{lines}}} (triple braces): it is markup`);
  if (!used.some((p) => p.name === "ctaUrl"))
    problems.push(
      `${file}: the template must contain {{ctaUrl}}: the link is the point of the mail`,
    );
  if (!used.some((p) => p.name === "lines"))
    warnings.push(`${file}: no {{{lines}}}: the message body will not appear`);
  void name;
}

export interface LoadOptions {
  /** `THEME_DIR` was set on purpose: a missing directory is then an error, not "use defaults". */
  explicit?: boolean;
  defaultDir?: string;
}

export function loadTheme(dir: string, opts: LoadOptions = {}): LoadedTheme {
  const defaultDir = opts.defaultDir ?? DEFAULT_THEME_DIR;
  const problems: string[] = [];
  const warnings: string[] = [];
  const exists = existsSync(dir) && statSync(dir).isDirectory();
  if (!exists && opts.explicit) throw new ThemeError(dir, [`THEME_DIR does not exist: ${dir}`]);

  const base = readJson(join(defaultDir, "theme.json"), problems);

  // theme.json: validated alone (so a partial file reports its own mistakes), then merged.
  let override: unknown = {};
  const themeFile = join(dir, "theme.json");
  if (exists && existsSync(themeFile)) {
    override = readJson(themeFile, problems);
    if (override !== undefined) {
      const r = themeInputSchema.safeParse(override);
      if (!r.success) problems.push(...formatIssues(r.error, "theme.json: "));
    }
  }
  const merged = deepMerge(base, override ?? {});
  const parsed = themeSchema.safeParse(merged);
  if (!parsed.success && !problems.length)
    problems.push(...formatIssues(parsed.error, "theme.json: "));
  const config = parsed.success ? (parsed.data as ThemeConfig) : null;

  const assetsDir = join(dir, "assets");
  const assets = exists ? listFiles(assetsDir) : [];
  if (config) {
    const need = (file: string | null, what: string) => {
      if (file && !file.startsWith("https:") && !assets.includes(file))
        problems.push(`theme.json: ${what} "${file}" is not in ${assetsDir}`);
    };
    need(config.logo, "logo");
    need(config.favicon, "favicon");
    config.fonts.faces.forEach((f, i) => need(f.file, `fonts.faces.${i}.file`));
  }

  if (config) {
    // `theme.css` loads after `styles.css` with equal specificity: a derived token set in one mode
    // only would also replace the derived value of the other.
    for (const key of Object.keys(COLOR_VARS) as ColorKey[]) {
      const [l, d] = [config.colors.light[key], config.colors.dark[key]];
      const shipped = (base as { colors?: { light?: Record<string, unknown> } })?.colors?.light;
      if (!!l !== !!d && !(key in (shipped ?? {})))
        warnings.push(
          `theme.json: colors.${l ? "light" : "dark"}.${key} is set but not in ${l ? "dark" : "light"}: set it in both modes or neither`,
        );
    }
  }

  // messages/<locale>.json over the shipped catalogues.
  const messages: MessageOverrides = { ca: {}, es: {}, en: {} };
  const messagesDir = join(dir, "messages");
  if (exists && existsSync(messagesDir)) {
    for (const f of readdirSync(messagesDir)) {
      const locale = f.replace(/\.json$/, "");
      if (!f.endsWith(".json") || !(LOCALE_CODES as readonly string[]).includes(locale)) {
        warnings.push(
          `messages/${f}: ignored (expected ${LOCALE_CODES.map((l) => `${l}.json`).join(", ")})`,
        );
        continue;
      }
      const file = `messages/${f}`;
      const raw = readJson(join(messagesDir, f), problems);
      if (raw === undefined) continue;
      const flat = flattenMessages(raw, problems, file);
      const shipped = catalogs[locale as LocaleCode];
      for (const [k, v] of Object.entries(flat)) {
        if (!(k in ca)) {
          warnings.push(`${file}: unknown message key "${k}" (ignored)`);
          continue;
        }
        const lost = [...placeholderSet(shipped[k]!)].filter((p) => !placeholderSet(v).has(p));
        if (lost.length)
          warnings.push(`${file}: "${k}" drops {${lost.join("}, {")}} used by the original`);
        messages[locale as LocaleCode][k] = v;
      }
    }
  }

  // emails: the shipped layout, optionally replaced per name.
  const layoutPath = join(defaultDir, "emails", "layout.html");
  let layout = "";
  try {
    layout = readFileSync(layoutPath, "utf8");
  } catch (e) {
    problems.push(`${layoutPath}: ${(e as Error).message}`);
  }
  const byName: Partial<Record<string, string>> = {};
  const emailsDir = join(dir, "emails");
  if (exists && existsSync(emailsDir)) {
    for (const f of readdirSync(emailsDir)) {
      const name = f.replace(/\.html$/, "");
      if (!f.endsWith(".html") || !(EMAIL_TEMPLATE_NAMES as readonly string[]).includes(name)) {
        warnings.push(
          `emails/${f}: ignored (known names: ${EMAIL_TEMPLATE_NAMES.map((n) => `${n}.html`).join(", ")})`,
        );
        continue;
      }
      const source = readFileSync(join(emailsDir, f), "utf8");
      checkEmail(name, source, `emails/${f}`, problems, warnings);
      if (name === "layout") layout = source;
      else byName[name] = source;
    }
  }
  checkEmail("layout", layout, "emails/layout.html (default)", [], []);

  // slots/<Name>.tsx present on disk.
  const slotsDir = join(dir, "slots");
  const slots: SlotName[] = [];
  if (exists && existsSync(slotsDir)) {
    for (const f of readdirSync(slotsDir)) {
      const name = f.replace(/\.tsx$/, "");
      if (f.endsWith(".tsx") && (SLOT_NAMES as readonly string[]).includes(name))
        slots.push(name as SlotName);
      else
        warnings.push(
          `slots/${f}: ignored (slots are ${SLOT_NAMES.map((n) => `${n}.tsx`).join(", ")})`,
        );
    }
  }

  const customPath = join(dir, "custom.css");
  const custom = exists && existsSync(customPath) ? readFileSync(customPath, "utf8") : "";

  if (problems.length || !config) throw new ThemeError(dir, problems);
  const variablesCss = themeVariables(config);
  const css = `${variablesCss}${custom ? `${custom}${custom.endsWith("\n") ? "" : "\n"}` : ""}`;
  return {
    dir,
    exists,
    config,
    variablesCss,
    css,
    cssHash: createHash("sha1").update(css).digest("hex").slice(0, 10),
    messages,
    emails: { layout, byName },
    assetsDir,
    assets,
    slots,
    warnings,
  };
}

/** Picks the text for a locale: that locale, then `fallback`, then any entry. */
export function localize(
  text: LocalizedText | null,
  locale: LocaleCode,
  fallback: LocaleCode,
): string | null {
  if (text === null) return null;
  if (typeof text === "string") return text;
  return text[locale] ?? text[fallback] ?? Object.values(text)[0] ?? null;
}

/** What the browser needs from the theme, for one locale. Serialisable; no paths or sources. */
export interface PublicTheme {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  supportEmail: string | null;
  projectUrl: string | null;
  legalLinks: { label: string; href: string }[];
  /** `/theme/theme.css?v=<hash>`: variables, font faces and custom.css, in that order. */
  cssUrl: string;
  /** Message overrides for this locale; merged over the shipped catalogue by the i18n provider. */
  messages: Record<string, string>;
}

const resolveRef = (ref: string | null) =>
  ref === null ? null : ref.startsWith("https:") ? ref : assetUrl(ref);

export function publicTheme(theme: LoadedTheme, locale: LocaleCode): PublicTheme {
  const c = theme.config;
  const fb = c.defaultLocale;
  return {
    name: c.name,
    tagline: localize(c.tagline, locale, fb),
    logoUrl: resolveRef(c.logo),
    faviconUrl: resolveRef(c.favicon),
    supportEmail: c.supportEmail,
    projectUrl: c.projectUrl,
    legalLinks: c.legalLinks.map((l) => ({
      label: localize(l.label, locale, fb) ?? l.href,
      href: l.href,
    })),
    cssUrl: `/theme/theme.css?v=${theme.cssHash}`,
    messages: theme.messages[locale],
  };
}
