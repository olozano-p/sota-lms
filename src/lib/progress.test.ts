import { describe, expect, it } from "vitest";
import {
  chapterPosition,
  chapterRelease,
  continueTarget,
  courseProgress,
  courseState,
} from "./progress";

const L = (
  id: string,
  o: Partial<{ status: "draft" | "published"; accessible: boolean; completed: boolean }> = {},
) => ({
  id,
  status: o.status ?? ("published" as const),
  accessible: o.accessible ?? true,
  completed: o.completed ?? false,
});

describe("courseProgress", () => {
  it("counts published lessons only", () => {
    expect(
      courseProgress([
        L("a", { completed: true }),
        L("b"),
        L("c", { status: "draft", completed: true }),
      ]),
    ).toEqual({ completed: 1, total: 2, ratio: 0.5 });
    expect(courseProgress([])).toEqual({ completed: 0, total: 0, ratio: 0 });
  });
});

describe("continueTarget", () => {
  it("picks the first accessible, unfinished, published lesson", () => {
    expect(
      continueTarget([L("a", { completed: true }), L("b", { accessible: false }), L("c"), L("d")])
        ?.id,
    ).toBe("c");
  });
  it("falls back to the last accessible lesson when everything is done", () => {
    expect(
      continueTarget([
        L("a", { completed: true }),
        L("b", { completed: true }),
        L("c", { accessible: false }),
      ])?.id,
    ).toBe("b");
  });
  it("returns null when nothing is open", () => {
    expect(continueTarget([L("a", { accessible: false }), L("b", { status: "draft" })])).toBeNull();
  });
});

describe("courseState", () => {
  const p = (completed: number, total: number) => ({ completed, total, ratio: 0 });
  it("is finished when every lesson is done, open or not", () => {
    expect(courseState(p(3, 3), { ok: true }, true)).toBe("finished");
    expect(courseState(p(3, 3), { ok: false }, true)).toBe("finished");
  });
  it("is locked when the course does not open, unless it is complete", () => {
    expect(courseState(p(0, 3), { ok: false }, false)).toBe("locked");
  });
  it("is in progress once anything was started, else not started", () => {
    expect(courseState(p(0, 3), { ok: true }, true)).toBe("in_progress");
    expect(courseState(p(0, 3), { ok: true }, false)).toBe("not_started");
    expect(courseState(p(0, 0), { ok: true }, false)).toBe("not_started");
  });
});

describe("chapterPosition", () => {
  it("counts distinct chapters in order", () => {
    expect(chapterPosition(["a", "a", "b", "c", "c"], "b")).toEqual({ index: 2, total: 3 });
    expect(chapterPosition(["a"], "z")).toBeNull();
  });
});

describe("chapterRelease", () => {
  const wait = (iso: string) => ({
    ok: false,
    reason: "not_yet_released",
    availableAt: new Date(iso),
  });
  it("is the earliest date when every lesson waits for a release", () => {
    expect(chapterRelease([wait("2026-11-11"), wait("2026-11-04")])).toEqual(
      new Date("2026-11-04"),
    );
  });
  it("is null when any lesson is open or locked for another reason", () => {
    expect(chapterRelease([wait("2026-11-04"), { ok: true }])).toBeNull();
    expect(chapterRelease([wait("2026-11-04"), { ok: false, reason: "expired" }])).toBeNull();
    expect(chapterRelease([])).toBeNull();
  });
});
