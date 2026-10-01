/** Catalog lookup with `{param}` interpolation. Plain-Node safe (used by the mail templates). */
import { ca, type MessageKey } from "./ca.ts";
import { es } from "./es.ts";
import { en } from "./en.ts";
import type { Locale } from "./locale.ts";

export const catalogs: Record<Locale, Record<MessageKey, string>> = { ca, es, en };

/**
 * `overrides` are the deployment's theme messages for `locale` (docs/theming.md); they win over the
 * shipped catalogue, which in turn falls back to Catalan.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
  overrides?: Readonly<Record<string, string>>,
): string {
  const template = overrides?.[key] ?? catalogs[locale][key] ?? catalogs.ca[key] ?? key;
  return params
    ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
    : template;
}
