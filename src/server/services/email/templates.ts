/**
 * One function per notification kind → subject/text/html in the recipient's locale. Copy lives
 * in the i18n catalogs (`mail.*` keys) so translators see it with everything else.
 */
import { translate } from "../../../i18n/translate.ts";
import type { Locale } from "../../../i18n/locale.ts";
import type { MessageKey } from "../../../i18n/ca.ts";
import { emailPalette, escapeHtml, fillTemplate } from "../../../theme/email.ts";
import { localize, type LoadedTheme } from "../../../theme/load.ts";
import { getTheme } from "../../../theme/runtime.ts";

export type NotificationKind =
  | "submission_received"
  | "feedback_returned"
  | "chapter_released"
  | "forum_reply"
  | "forum_thread"
  | AccountMailKind;

/** Account mail carries a one-time link and is addressed by email; it never enters a digest. */
export const ACCOUNT_MAIL_KINDS = [
  "auth_magic_link",
  "auth_verify_email",
  "auth_reset_password",
  "auth_invite",
] as const;
export type AccountMailKind = (typeof ACCOUNT_MAIL_KINDS)[number];

export const isAccountMailKind = (kind: string): kind is AccountMailKind =>
  (ACCOUNT_MAIL_KINDS as readonly string[]).includes(kind);

export interface NotificationPayload {
  /** Empty for the general forum, which belongs to no course. */
  courseTitle: string;
  /** Deep link, absolute. */
  url: string;
  /** Kind-specific: student name, assignment title, chapter title… */
  subject?: string;
  detail?: string;
  /** Recipient language for account mail sent before a person row exists. */
  locale?: string;
}

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

interface Ctx {
  brand: string;
  kind: string;
  locale: Locale;
  theme: LoadedTheme;
}

/**
 * Text part by code; HTML part from the theme's template for `kind` (`emails/<kind>.html`), else
 * its `layout.html`, else the shipped one (docs/theming.md).
 */
function layout(
  ctx: Ctx,
  title: string,
  lines: string[],
  cta: { label: string; url: string },
): Rendered {
  const { brand, theme } = ctx;
  const text = [title, "", ...lines, "", `${cta.label}: ${cta.url}`, "", `— ${brand}`].join("\n");
  const html = fillTemplate(theme.emails.byName[ctx.kind] ?? theme.emails.layout, {
    ...emailPalette(theme.config),
    brand,
    title,
    lines: lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join(""),
    ctaLabel: cta.label,
    ctaUrl: cta.url,
    tagline: localize(theme.config.tagline, ctx.locale, theme.config.defaultLocale) ?? "",
    supportEmail: theme.config.supportEmail ?? "",
  });
  return { subject: title, text, html };
}

export function renderNotification(
  kind: NotificationKind,
  payload: NotificationPayload,
  locale: Locale,
  brand: string,
  theme: LoadedTheme = getTheme(),
): Rendered {
  const overrides = theme.messages[locale];
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params, overrides);
  const ctx: Ctx = { brand, kind, locale, theme };
  const p = {
    course: payload.courseTitle || t("mail.forum.general"),
    subject: payload.subject ?? "",
    detail: payload.detail ?? "",
    brand,
  };
  const L = (name: string) => `mail.${name}` as MessageKey;
  const mail = (prefix: string, extra: string[] = []) =>
    layout(ctx, t(L(`${prefix}.title`), p), [t(L(`${prefix}.body`), p), ...extra], {
      label: t(L(`${prefix}.cta`)),
      url: payload.url,
    });
  switch (kind) {
    case "submission_received":
      return mail("submission");
    case "feedback_returned":
      return mail("feedback", payload.detail ? [payload.detail] : []);
    case "chapter_released":
      return mail("release");
    case "forum_reply":
      return mail("forumReply");
    case "forum_thread":
      return mail("forumThread");
    case "auth_magic_link":
      return mail("auth.magic");
    case "auth_verify_email":
      return mail("auth.verify");
    case "auth_reset_password":
      return mail("auth.reset");
    case "auth_invite":
      return mail("auth.invite");
  }
}

/** Several digest items for one person, one mail. */
export function renderDigest(
  items: { kind: NotificationKind; payload: NotificationPayload }[],
  locale: Locale,
  brand: string,
  homeUrl: string,
  theme: LoadedTheme = getTheme(),
): Rendered {
  const overrides = theme.messages[locale];
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params, overrides);
  const lines = items.map((i) => {
    const r = renderNotification(i.kind, i.payload, locale, brand, theme);
    return `• ${r.subject} — ${i.payload.url}`;
  });
  return layout(
    { brand, kind: "digest", locale, theme },
    t("mail.digest.title", { n: items.length }),
    [t("mail.digest.body"), ...lines],
    { label: t("mail.digest.cta"), url: homeUrl },
  );
}
