import { describe, expect, it } from "vitest";
import { addDays, dateInZone, startOfDay, zonedMidnight } from "./dates";

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 30)).toBe("2027-01-30");
  });
  it("formats a date in a zone", () => {
    expect(dateInZone(new Date("2026-06-30T23:30:00Z"), "Europe/Madrid")).toBe("2026-07-01");
    expect(dateInZone(new Date("2026-06-30T23:30:00Z"), "UTC")).toBe("2026-06-30");
  });
  it("finds local midnight in a zone", () => {
    expect(zonedMidnight("2026-07-01", "Europe/Madrid").toISOString()).toBe(
      "2026-06-30T22:00:00.000Z",
    );
    expect(zonedMidnight("2026-01-15", "Europe/Madrid").toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
    expect(zonedMidnight("2026-01-15", "UTC").toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(zonedMidnight("2026-01-15", "America/Los_Angeles").toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });
  it("starts a day at midnight UTC", () => {
    expect(startOfDay("2026-02-03").toISOString()).toBe("2026-02-03T00:00:00.000Z");
  });
});
