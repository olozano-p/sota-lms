/**
 * The clock is read here and nowhere else, so that rules stay testable (they take `now`) and
 * "which day is it" does not depend on the caller's timezone.
 */

export function now(): Date {
  return new Date();
}

/** `YYYY-MM-DD` of an instant in the given IANA zone. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds whole days to a `YYYY-MM-DD` date (UTC arithmetic, safe across DST). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Start of a `YYYY-MM-DD` day as an instant, at 00:00 UTC. Good enough for date-granular rules. */
export function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Offset (ms) between the wall clock in `timeZone` and UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which `YYYY-MM-DD` begins (00:00) in `timeZone`. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const offset = zoneOffsetMs(guess, timeZone);
  const candidate = new Date(guess.getTime() - offset);
  // A DST transition between the guess and the candidate shifts the offset; one correction suffices.
  const drift = zoneOffsetMs(candidate, timeZone) - offset;
  return drift ? new Date(candidate.getTime() - drift) : candidate;
}
