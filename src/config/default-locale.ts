/**
 * The language used when nothing else decides: `DEFAULT_LOCALE` from the environment, else the
 * theme's `defaultLocale`; either only when that locale is enabled in `lms.config.ts`, otherwise
 * the first enabled one. Server-only (reads the environment); plain-Node safe.
 */
import { getTheme } from "../theme/runtime.ts";
import { lmsConfig } from "./index.ts";
import { env } from "./env.ts";
import type { LocaleCode } from "./schema.ts";

export function defaultLocale(): LocaleCode {
  const enabled = lmsConfig.locales.enabled;
  for (const candidate of [env.defaultLocale, getTheme().config.defaultLocale])
    if (candidate && enabled.includes(candidate)) return candidate;
  return enabled[0]!;
}
