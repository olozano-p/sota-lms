import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

/** Small uppercase section label — the one place wide tracking is welcome. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
