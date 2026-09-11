import { cn } from "~/lib/cn";

interface ProgressRuleProps {
  /** 0–1 */
  value: number;
  label: string;
  className?: string;
}

/** Progress is a 2 px rule, never a ring (docs/DESIGN.md). */
export function ProgressRule({ value, label, className }: ProgressRuleProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={cn("h-0.5 w-full bg-border", className)}
    >
      <div
        className="h-full bg-primary transition-[width] duration-[120ms] ease-(--ease)"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
