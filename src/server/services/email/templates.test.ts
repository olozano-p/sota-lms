import { describe, expect, it } from "vitest";
import { renderNotification } from "./templates.ts";

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
