import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MessageKey } from "./ca";
import { INTL_TAG, LOCALES, LOCALE_NAMES, isLocale, type Locale } from "./locale";
import { translate } from "./translate";

export { LOCALES, LOCALE_NAMES, isLocale, translate };
export type { Locale, MessageKey };

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** "12 de març de 2026" from a Date or ISO string. */
  fmtDate: (date: Date | string) => string;
  /** "12 març" */
  fmtDayMonth: (date: Date | string) => string;
  /** "12 de març, 18:00" */
  fmtDateTime: (date: Date | string) => string;
  /** "fa 3 dies" / "d'aquí a 2 hores" relative to `now`. */
  fmtRelative: (date: Date | string, now?: Date) => string;
  /** "1 h 25 min" from seconds. */
  fmtDuration: (seconds: number) => string;
  fmtNumber: (n: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

const asDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/** `messages` are the theme's overrides for `locale` (docs/theming.md); they win over the catalogue. */
export function createI18n(
  locale: Locale,
  timeZone: string,
  messages?: Readonly<Record<string, string>>,
): I18n {
  const tag = INTL_TAG[locale];
  const date = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
  const dayMonth = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone });
  const dateTime = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const number = new Intl.NumberFormat(tag);
  return {
    locale,
    t: (key, params) => translate(locale, key, params, messages),
    fmtDate: (d) => date.format(asDate(d)),
    fmtDayMonth: (d) => dayMonth.format(asDate(d)),
    fmtDateTime: (d) => dateTime.format(asDate(d)),
    fmtRelative: (d, now = new Date()) => {
      const diff = (asDate(d).getTime() - now.getTime()) / 1000;
      const abs = Math.abs(diff);
      if (abs < 60) return relative.format(Math.round(diff), "second");
      if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
      if (abs < 86400) return relative.format(Math.round(diff / 3600), "hour");
      if (abs < 86400 * 30) return relative.format(Math.round(diff / 86400), "day");
      return relative.format(Math.round(diff / (86400 * 30)), "month");
    },
    fmtDuration: (seconds) => {
      const m = Math.round(seconds / 60);
      if (m < 60) return `${m} min`;
      const h = Math.floor(m / 60);
      const rest = m % 60;
      return rest ? `${h} h ${rest} min` : `${h} h`;
    },
    fmtNumber: (n) => number.format(n),
  };
}

export function I18nProvider({
  locale,
  timeZone,
  messages,
  children,
}: {
  locale: Locale;
  timeZone: string;
  messages?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const value = useMemo(() => createI18n(locale, timeZone, messages), [locale, timeZone, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
