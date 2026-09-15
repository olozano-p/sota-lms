import { describe, expect, it } from "vitest";
import {
  compareThreads,
  forumFileKey,
  forumScopeFromFileKey,
  nextReaction,
  participants,
} from "./forum";

describe("nextReaction", () => {
  it("toggles and replaces", () => {
    expect(nextReaction(null, "like")).toBe("like");
    expect(nextReaction("like", "like")).toBeNull();
    expect(nextReaction("like", "dislike")).toBe("dislike");
    expect(nextReaction("dislike", null)).toBeNull();
  });
});

describe("participants", () => {
  it("dedupes, drops nulls and the actor, keeps first-seen order", () => {
    expect(participants(["a", null, "b", "a", "me", "c", "b"], "me")).toEqual(["a", "b", "c"]);
  });
});

describe("compareThreads", () => {
  const d = (s: string) => new Date(s);
  it("puts pinned first, newest pin on top, then latest activity", () => {
    const rows = [
      { id: "old", pinnedAt: null, lastActivityAt: d("2026-01-01") },
      { id: "fresh", pinnedAt: null, lastActivityAt: d("2026-03-01") },
      { id: "pin-early", pinnedAt: d("2026-02-01"), lastActivityAt: d("2025-01-01") },
      { id: "pin-late", pinnedAt: d("2026-02-05"), lastActivityAt: d("2025-01-01") },
    ];
    expect(rows.sort(compareThreads).map((r) => r.id)).toEqual([
      "pin-late",
      "pin-early",
      "fresh",
      "old",
    ]);
  });
});

describe("forum file keys", () => {
  const courseId = "01a09740-6193-70b7-8ab0-5df55fe0db81";
  it("round-trips course and general scopes", () => {
    const k = forumFileKey({ kind: "course", courseId }, "u1", "my photo.png");
    expect(k).toBe(`forum/course/${courseId}/u1-my_photo.png`);
    expect(forumScopeFromFileKey(k)).toEqual({ kind: "course", courseId });
    expect(forumScopeFromFileKey(forumFileKey({ kind: "general" }, "u2", "a.jpg"))).toEqual({
      kind: "general",
    });
  });
  it("rejects other prefixes", () => {
    expect(forumScopeFromFileKey(`courses/${courseId}/x.png`)).toBeNull();
    expect(forumScopeFromFileKey("forum/course/not-a-uuid/x.png")).toBeNull();
  });
});
