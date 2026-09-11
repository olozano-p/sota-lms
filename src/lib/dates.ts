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
