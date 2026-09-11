import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { lmsConfig } from "~/config";
import { isLocale, type Locale } from "~/i18n/locale";

const enabled = (l: unknown): l is Locale => isLocale(l) && lmsConfig.locales.enabled.includes(l);

function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (enabled(tag)) return tag;
  }
  return null;
}

/**
 * Locale resolution order (docs/spec.md §2): `?lang` → cookie → IdP `locale` claim →
 * `Accept-Language` → config default. `?lang` also persists to the cookie so a link from a parent
 * site sticks.
 */
export const getLocale = createServerFn({ method: "GET" })
  .validator(z.object({ lang: z.string().optional(), claim: z.string().nullable().optional() }))
  .handler(async ({ data }): Promise<Locale> => {
    const { cookieName } = lmsConfig.locales;
    if (enabled(data.lang)) {
      setLocaleCookie(data.lang);
      return data.lang;
    }
    const cookie = getCookie(cookieName);
    if (enabled(cookie)) return cookie;
    if (enabled(data.claim)) return data.claim;
    const negotiated = fromAcceptLanguage(getRequest().headers.get("accept-language"));
    return negotiated ?? lmsConfig.locales.default;
  });

export const setLocale = createServerFn({ method: "POST" })
  .validator(z.object({ locale: z.string() }))
  .handler(async ({ data }): Promise<Locale> => {
    if (!enabled(data.locale)) return lmsConfig.locales.default;
    setLocaleCookie(data.locale);
    return data.locale;
  });

function setLocaleCookie(locale: Locale): void {
  const domain = process.env.COOKIE_DOMAIN;
  setCookie(lmsConfig.locales.cookieName, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    ...(domain ? { domain } : {}),
  });
}
