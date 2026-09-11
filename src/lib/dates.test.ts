import { describe, expect, it } from "vitest";
import { addDays, dateInZone, startOfDay } from "./dates";

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
  it("starts a day at midnight UTC", () => {
    expect(startOfDay("2026-02-03").toISOString()).toBe("2026-02-03T00:00:00.000Z");
  });
});
