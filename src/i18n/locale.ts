import { LOCALE_CODES, type LocaleCode } from "../config/schema.ts";

export const LOCALES = LOCALE_CODES;
export type Locale = LocaleCode;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Native-language names, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ca: "Català",
  es: "Castellano",
  en: "English",
};

/** BCP-47 tags for Intl formatting. */
export const INTL_TAG: Record<Locale, string> = { ca: "ca-ES", es: "es-ES", en: "en-GB" };
