import { describe, expect, it } from "vitest";
import { continueTarget, courseProgress } from "./progress";

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
