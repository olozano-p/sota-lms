import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

/** Section label: the uppercase tracked sans at half ink. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("label text-muted-foreground", className)} {...props} />;
}
