/**
 * The language used when nothing else decides: `DEFAULT_LOCALE` from the environment when it names
 * an enabled locale, otherwise `lms.config.ts`. Server-only (reads the environment); plain-Node safe.
 */
import { lmsConfig } from "./index.ts";
import { env } from "./env.ts";
import type { LocaleCode } from "./schema.ts";

export function defaultLocale(): LocaleCode {
  const fromEnv = env.defaultLocale;
  return fromEnv && lmsConfig.locales.enabled.includes(fromEnv)
    ? fromEnv
    : lmsConfig.locales.default;
}
