import { describe, expect, it } from "vitest";
import { loadTheme } from "../../../theme/load.ts";
import { renderDigest, renderNotification } from "./templates.ts";

const payload = {
  courseTitle: "",
  subject: "Com mantenir la postura?",
  detail: "Marta Mestra",
  url: "https://lms.example/forum/t1#post-p1",
};

describe("forum notifications", () => {
  it("names the general forum when the thread belongs to no course", () => {
    for (const locale of ["ca", "es", "en"] as const) {
      const r = renderNotification("forum_reply", payload, locale, "SOTA");
      expect(r.subject).toContain("Com mantenir la postura?");
      expect(r.text).not.toMatch(/\{\w+\}/);
      expect(r.text).toMatch(/Fòrum general|Foro general|General forum/);
      expect(r.text).toContain(payload.url);
    }
  });
  it("tells teachers who opened a thread in their course", () => {
    const r = renderNotification(
      "forum_thread",
      { ...payload, courseTitle: "Introducció", detail: "Aina" },
      "en",
      "SOTA",
    );
    expect(r.subject).toBe("New thread in “Introducció”");
    expect(r.text).toContain("Aina started the thread “Com mantenir la postura?”");
  });
});

describe("themed mail", () => {
  const kinds = [
    "submission_received",
    "feedback_returned",
    "chapter_released",
    "forum_reply",
    "forum_thread",
    "auth_magic_link",
    "auth_verify_email",
    "auth_reset_password",
    "auth_invite",
  ] as const;

  it("renders every kind in every language with the shipped layout and no stray placeholders", () => {
    for (const kind of kinds)
      for (const locale of ["ca", "es", "en"] as const) {
        const r = renderNotification(kind, payload, locale, "SOTA");
        expect(r.subject, `${kind} ${locale}`).not.toMatch(/^mail\./);
        expect(r.html).toContain(payload.url);
        expect(r.html).not.toMatch(/\{\{|\{\w+\}/);
        expect(r.html).toContain("#e0a51c");
      }
  });

  it("escapes what it interpolates", () => {
    const r = renderNotification(
      "forum_reply",
      { ...payload, subject: "<img src=x onerror=alert(1)>", url: 'https://x.invalid/"><script>' },
      "en",
      'A"B',
    );
    expect(r.html).not.toContain("<img");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;img");
  });

  it("applies theme message overrides to subject and body", () => {
    const theme = loadTheme("/nonexistent");
    const t = {
      ...theme,
      messages: { ...theme.messages, en: { "mail.forumReply.cta": "Open it" } },
    };
    const r = renderNotification("forum_reply", payload, "en", "SOTA", t);
    expect(r.text).toContain("Open it:");
    expect(r.html).toContain("Open it");
  });

  it("uses emails/<kind>.html before layout.html before the shipped layout", () => {
    const base = loadTheme("/nonexistent");
    const t = {
      ...base,
      emails: {
        layout: "LAYOUT {{title}} {{ctaUrl}}",
        byName: { forum_reply: "KIND {{title}} {{ctaUrl}} {{{lines}}}" },
      },
    };
    expect(renderNotification("forum_reply", payload, "en", "SOTA", t).html).toMatch(/^KIND /);
    expect(renderNotification("forum_thread", payload, "en", "SOTA", t).html).toMatch(/^LAYOUT /);
    expect(
      renderDigest([{ kind: "forum_reply", payload }], "en", "SOTA", "https://x.invalid/", t).html,
    ).toMatch(/^LAYOUT /);
  });
});
