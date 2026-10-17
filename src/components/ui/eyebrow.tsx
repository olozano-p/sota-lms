import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

/** Section label: the `label` style in the muted ink. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("label text-muted-foreground", className)} {...props} />;
}
