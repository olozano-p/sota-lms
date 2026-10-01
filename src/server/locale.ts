import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { lmsConfig } from "~/config";
import { defaultLocale } from "~/config/default-locale";
import { env } from "~/config/env";
import { isLocale, type Locale } from "~/i18n/locale";
import { resolveLocale } from "~/lib/locale-resolve";

const enabled = (l: unknown): l is Locale => isLocale(l) && lmsConfig.locales.enabled.includes(l);

/**
 * Locale resolution order (docs/spec.md §2): `?lang` → cookie → the person's stored locale (`claim`) →
 * `Accept-Language` → config default. `?lang` also persists to the cookie so a link from a parent
 * site sticks.
 */
export const getLocale = createServerFn({ method: "GET" })
  .validator(z.object({ lang: z.string().optional(), claim: z.string().nullable().optional() }))
  .handler(async ({ data }): Promise<Locale> => {
    if (enabled(data.lang)) setLocaleCookie(data.lang);
    return resolveLocale({
      lang: data.lang,
      cookie: getCookie(lmsConfig.locales.cookieName),
      profile: data.claim,
      acceptLanguage: getRequest().headers.get("accept-language"),
      isEnabled: enabled,
      fallback: defaultLocale(),
    });
  });

export const setLocale = createServerFn({ method: "POST" })
  .validator(z.object({ locale: z.string() }))
  .handler(async ({ data }): Promise<Locale> => {
    if (!enabled(data.locale)) return defaultLocale();
    setLocaleCookie(data.locale);
    return data.locale;
  });

function setLocaleCookie(locale: Locale): void {
  const domain = env.cookieDomain;
  setCookie(lmsConfig.locales.cookieName, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    ...(domain ? { domain } : {}),
  });
}
