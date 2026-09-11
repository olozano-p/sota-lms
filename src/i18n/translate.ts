/** Catalog lookup with `{param}` interpolation. Plain-Node safe (used by the mail templates). */
import { ca, type MessageKey } from "./ca.ts";
import { es } from "./es.ts";
import { en } from "./en.ts";
import type { Locale } from "./locale.ts";

export const catalogs: Record<Locale, Record<MessageKey, string>> = { ca, es, en };

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = catalogs[locale][key] ?? catalogs.ca[key] ?? key;
  return params
    ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
    : template;
}
