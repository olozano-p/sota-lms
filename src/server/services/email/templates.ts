/**
 * One function per notification kind → subject/text/html in the recipient's locale. Copy lives
 * in the i18n catalogs (`mail.*` keys) so translators see it with everything else.
 */
import { translate } from "../../../i18n/translate.ts";
import type { Locale } from "../../../i18n/locale.ts";
import type { MessageKey } from "../../../i18n/ca.ts";

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

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(
  brand: string,
  title: string,
  lines: string[],
  cta: { label: string; url: string },
): Rendered {
  const text = [title, "", ...lines, "", `${cta.label}: ${cta.url}`, "", `— ${brand}`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1e1c19;font:16px/1.5 Georgia,serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(30,28,25,.12);border-radius:8px;padding:28px">
<h1 style="font-size:22px;font-weight:500;margin:0 0 16px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("")}
<p style="margin:24px 0 0"><a href="${esc(cta.url)}" style="display:inline-block;padding:10px 16px;background:#e0a51c;color:#1e1c19;text-decoration:none;border-radius:4px;font-family:system-ui,sans-serif;font-size:14px">${esc(cta.label)}</a></p>
</div><p style="max-width:560px;margin:16px auto 0;font:12px system-ui,sans-serif;color:#6b665e">${esc(brand)}</p></body></html>`;
  return { subject: title, text, html };
}

export function renderNotification(
  kind: NotificationKind,
  payload: NotificationPayload,
  locale: Locale,
  brand: string,
): Rendered {
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const p = {
    course: payload.courseTitle || t("mail.forum.general"),
    subject: payload.subject ?? "",
    detail: payload.detail ?? "",
    brand,
  };
  switch (kind) {
    case "submission_received":
      return layout(brand, t("mail.submission.title", p), [t("mail.submission.body", p)], {
        label: t("mail.submission.cta"),
        url: payload.url,
      });
    case "feedback_returned":
      return layout(
        brand,
        t("mail.feedback.title", p),
        [t("mail.feedback.body", p), ...(payload.detail ? [payload.detail] : [])],
        { label: t("mail.feedback.cta"), url: payload.url },
      );
    case "chapter_released":
      return layout(brand, t("mail.release.title", p), [t("mail.release.body", p)], {
        label: t("mail.release.cta"),
        url: payload.url,
      });
    case "forum_reply":
      return layout(brand, t("mail.forumReply.title", p), [t("mail.forumReply.body", p)], {
        label: t("mail.forumReply.cta"),
        url: payload.url,
      });
    case "forum_thread":
      return layout(brand, t("mail.forumThread.title", p), [t("mail.forumThread.body", p)], {
        label: t("mail.forumThread.cta"),
        url: payload.url,
      });
    case "auth_magic_link":
      return layout(brand, t("mail.auth.magic.title", p), [t("mail.auth.magic.body", p)], {
        label: t("mail.auth.magic.cta"),
        url: payload.url,
      });
    case "auth_verify_email":
      return layout(brand, t("mail.auth.verify.title", p), [t("mail.auth.verify.body", p)], {
        label: t("mail.auth.verify.cta"),
        url: payload.url,
      });
    case "auth_reset_password":
      return layout(brand, t("mail.auth.reset.title", p), [t("mail.auth.reset.body", p)], {
        label: t("mail.auth.reset.cta"),
        url: payload.url,
      });
    case "auth_invite":
      return layout(brand, t("mail.auth.invite.title", p), [t("mail.auth.invite.body", p)], {
        label: t("mail.auth.invite.cta"),
        url: payload.url,
      });
  }
}

/** Several digest items for one person, one mail. */
export function renderDigest(
  items: { kind: NotificationKind; payload: NotificationPayload }[],
  locale: Locale,
  brand: string,
  homeUrl: string,
): Rendered {
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const lines = items.map((i) => {
    const r = renderNotification(i.kind, i.payload, locale, brand);
    return `• ${r.subject} — ${i.payload.url}`;
  });
  return layout(
    brand,
    t("mail.digest.title", { n: items.length }),
    [t("mail.digest.body"), ...lines],
    { label: t("mail.digest.cta"), url: homeUrl },
  );
}
