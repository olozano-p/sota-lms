import { describe, expect, it } from "vitest";
import { dripSchedule } from "./drip.ts";

const chapters = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("dripSchedule", () => {
  it("releases one chapter every N days from the start date", () => {
    const rows = dripSchedule({
      chapterIds: chapters.map((c) => c.id),
      startDate: "2026-09-01",
      everyDays: 7,
      chaptersPerStep: 1,
      timeZone: "UTC",
    });
    expect(rows.map((r) => [r.chapterId, r.releaseAt.toISOString().slice(0, 10)])).toEqual([
      ["a", "2026-09-01"],
      ["b", "2026-09-08"],
      ["c", "2026-09-15"],
      ["d", "2026-09-22"],
      ["e", "2026-09-29"],
    ]);
  });
  it("opens several chapters per step", () => {
    const rows = dripSchedule({
      chapterIds: ["a", "b", "c", "d", "e"],
      startDate: "2026-09-01",
      everyDays: 14,
      chaptersPerStep: 2,
      timeZone: "UTC",
    });
    expect(rows.map((r) => r.releaseAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-01",
      "2026-09-15",
      "2026-09-15",
      "2026-09-29",
    ]);
  });
  it("starts each release at local midnight of the deployment zone, across DST", () => {
    const rows = dripSchedule({
      chapterIds: ["a", "b"],
      startDate: "2026-10-20",
      everyDays: 14,
      chaptersPerStep: 1,
      timeZone: "Europe/Madrid",
    });
    expect(rows[0]!.releaseAt.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    expect(rows[1]!.releaseAt.toISOString()).toBe("2026-11-02T23:00:00.000Z");
  });
  it("rejects a step that is not a positive whole number", () => {
    const base = { chapterIds: ["a"], startDate: "2026-09-01", timeZone: "UTC" };
    expect(() => dripSchedule({ ...base, everyDays: 0, chaptersPerStep: 1 })).toThrow();
    expect(() => dripSchedule({ ...base, everyDays: 7, chaptersPerStep: 0 })).toThrow();
    expect(() => dripSchedule({ ...base, everyDays: 1.5, chaptersPerStep: 1 })).toThrow();
  });
});
