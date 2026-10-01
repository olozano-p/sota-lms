/**
 * The drip rule generator: "N chapters every D days from the start date" expands to explicit
 * release instants, which the cohort mutation stores as `cohort_release` rows. Nothing about the
 * rule is stored, so access is still computed from dates only.
 */
import { addDays, zonedMidnight } from "./dates.ts";

export interface DripInput {
  /** Chapters in course order. */
  chapterIds: string[];
  /** `YYYY-MM-DD`, the day the first step opens (deployment zone). */
  startDate: string;
  everyDays: number;
  chaptersPerStep: number;
  timeZone: string;
}

export function dripSchedule(input: DripInput): { chapterId: string; releaseAt: Date }[] {
  const { everyDays, chaptersPerStep } = input;
  if (!Number.isInteger(everyDays) || everyDays < 1) throw new Error("everyDays must be >= 1");
  if (!Number.isInteger(chaptersPerStep) || chaptersPerStep < 1)
    throw new Error("chaptersPerStep must be >= 1");
  return input.chapterIds.map((chapterId, i) => ({
    chapterId,
    releaseAt: zonedMidnight(
      addDays(input.startDate, Math.floor(i / chaptersPerStep) * everyDays),
      input.timeZone,
    ),
  }));
}
