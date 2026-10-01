/**
 * Locale resolution order (CLAUDE.md, fixed): `?lang` → cookie → the person's stored locale (the
 * IdP `locale` claim or their profile) → `Accept-Language` → config default.
 */
export interface LocaleSources<L extends string> {
  lang?: string | null;
  cookie?: string | null;
  profile?: string | null;
  acceptLanguage?: string | null;
  isEnabled: (value: unknown) => value is L;
  fallback: L;
}

export function negotiate<L extends string>(
  header: string | null | undefined,
  isEnabled: (value: unknown) => value is L,
): L | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (isEnabled(tag)) return tag;
  }
  return null;
}

export function resolveLocale<L extends string>(s: LocaleSources<L>): L {
  if (s.isEnabled(s.lang)) return s.lang;
  if (s.isEnabled(s.cookie)) return s.cookie;
  if (s.isEnabled(s.profile)) return s.profile;
  return negotiate(s.acceptLanguage, s.isEnabled) ?? s.fallback;
}
