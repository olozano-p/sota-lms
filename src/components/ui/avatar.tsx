import { cn } from "~/lib/cn";

/** Initials in the one circle the design allows (docs/DESIGN.md); no per-person colour. */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-medium text-foreground select-none",
        size === "sm" ? "size-6 text-[0.625rem]" : "size-9 text-xs",
        className,
      )}
    >
      {initials}
    </span>
  );
}
