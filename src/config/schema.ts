/**
 * Shape of `lms.config.ts`: the non-visual deployment config. Runs under plain Node (migrate, seed)
 * and in the bundle, so no alias imports here. Names, logo, colours, fonts and the default
 * language belong to the theme (`theme/theme.json`, docs/theming.md).
 */
import { z } from "zod";

export const LOCALE_CODES = ["ca", "es", "en"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

export const lmsConfigSchema = z.object({
  locales: z.object({
    enabled: z.array(z.enum(LOCALE_CODES)).min(1),
    /** Cookie name; set the domain in `.env` (`COOKIE_DOMAIN`) so a parent site can share it. */
    cookieName: z.string().default("sota_locale"),
  }),
  /** IANA zone used to turn instants into calendar days (expiry notices, digests). */
  timeZone: z.string().default("UTC"),
  /** Hostnames allowed in `embed` blocks and in the CSP `frame-src`. */
  embedAllowlist: z.array(z.string()).default([]),
  uploads: z.object({
    maxBytes: z.number().int().positive(),
    allowedMime: z.array(z.string()).min(1),
  }),
  notifications: z.object({
    /** Emails are sent at all; individuals can still opt out. */
    enabled: z.boolean().default(true),
    /** Hour (0–23, in `timeZone`) at which the daily digest is assembled. */
    digestHour: z.number().int().min(0).max(23).default(8),
  }),
  forum: z
    .object({
      /** A forum outside any course, open to every signed-in person. */
      general: z.boolean().default(false),
      /** Largest image a post may embed. */
      imageMaxBytes: z
        .number()
        .int()
        .positive()
        .default(5 * 1024 * 1024),
      /** Threads per page in a forum listing. */
      pageSize: z.number().int().min(5).max(100).default(25),
    })
    .prefault({}),
});

export type LmsConfig = z.infer<typeof lmsConfigSchema>;
export type LmsConfigInput = z.input<typeof lmsConfigSchema>;

/** Keys that used to live here and are now part of the theme (docs/theming.md, ADR-019). */
const MOVED = {
  brand: "name, logo, colours and project link are in theme/theme.json",
  contactEmail: "it is `supportEmail` in theme/theme.json",
} as const;

export function defineConfig(input: LmsConfigInput): LmsConfig {
  const raw = input as Record<string, unknown>;
  for (const [key, where] of Object.entries(MOVED))
    if (key in raw) throw new Error(`lms.config.ts: \`${key}\` moved: ${where}`);
  const locales = raw.locales as Record<string, unknown> | undefined;
  if (locales && "default" in locales)
    throw new Error(
      "lms.config.ts: `locales.default` moved: it is `defaultLocale` in theme/theme.json",
    );
  return lmsConfigSchema.parse(input);
}
