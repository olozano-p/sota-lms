/**
 * Shape of `lms.config.ts`. Runs under plain Node (migrate, seed) and in the bundle, so no alias
 * imports here. Everything a deploying organisation may want to change lives in this file.
 */
import { z } from "zod";

export const LOCALE_CODES = ["ca", "es", "en"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

/**
 * Access rule types the core understands. The entitlement source names *instances* of these
 * (e.g. "immediate", "delayed") in each entitlement's `rule` field; the mapping from an
 * organisation's tiers to those names happens outside Lodrö.
 */
export const accessRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediate") }),
  z.object({ type: z.literal("delayed_after_course_end"), days: z.number().int().min(0) }),
  z.object({ type: z.literal("fixed_date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);
export type AccessRule = z.infer<typeof accessRuleSchema>;

export const lmsConfigSchema = z.object({
  brand: z.object({
    /** Product name shown in the shell and emails. */
    name: z.string().min(1),
    /** Optional path under `public/` to a logo; the built-in mark is used when absent. */
    logo: z.string().nullable().default(null),
    /** Where the footer's "Made with Lodrö" points; your fork or the upstream project. */
    projectUrl: z.string().url().default("https://github.com/olozano-p/sota-lms"),
    /** Optional accent overrides (hex). Applied as CSS variables; tokens stay semantic. */
    colors: z
      .object({
        primary: z.string().optional(),
        primaryForeground: z.string().optional(),
        link: z.string().optional(),
        primaryDark: z.string().optional(),
        primaryForegroundDark: z.string().optional(),
        linkDark: z.string().optional(),
      })
      .default({}),
  }),
  locales: z.object({
    default: z.enum(LOCALE_CODES),
    enabled: z.array(z.enum(LOCALE_CODES)).min(1),
    /** Cookie name; set the domain in `.env` (`COOKIE_DOMAIN`) so a parent site can share it. */
    cookieName: z.string().default("lodro_locale"),
  }),
  /** IANA zone used to turn dates (course end, release dates) into instants. */
  timeZone: z.string().default("UTC"),
  accessRules: z.record(z.string(), accessRuleSchema),
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
  /** Address shown in SECURITY.md-style footers and error pages. */
  contactEmail: z.string().email().nullable().default(null),
});

export type LmsConfig = z.infer<typeof lmsConfigSchema>;
export type LmsConfigInput = z.input<typeof lmsConfigSchema>;

export function defineConfig(input: LmsConfigInput): LmsConfig {
  return lmsConfigSchema.parse(input);
}
