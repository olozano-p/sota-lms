import { useI18n } from "~/i18n";

/** Relative time with the exact instant on hover; the server and client clocks may differ. */
export function When({ date, className }: { date: Date | string; className?: string }) {
  const { fmtRelative, fmtDateTime } = useI18n();
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    <time
      dateTime={d.toISOString()}
      title={fmtDateTime(d)}
      className={className}
      suppressHydrationWarning
    >
      {fmtRelative(d)}
    </time>
  );
}
