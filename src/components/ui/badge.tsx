import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/cn";

/**
 * A tag. `secondary` is the sand box (module labels, steps); `outline` is the bare label of
 * metadata, optionally with a 14 px icon; the state variants are a dot plus the word, so status is
 * never colour alone.
 */
// The status dot sits where the 14 px icon would: a 6 px disc with 4 px either side.
const DOT = "before:mx-1 before:size-1.5 before:shrink-0 before:rounded-full";

export const badgeVariants = cva(
  "label inline-flex items-center gap-1 whitespace-nowrap rounded-sm text-foreground/60 [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "h-8 bg-primary px-2 text-primary-foreground",
        secondary: "h-8 bg-tint px-2",
        outline: "",
        success: [DOT, "before:bg-success"],
        warning: [DOT, "before:bg-warning"],
        destructive: [DOT, "before:bg-destructive"],
        info: [DOT, "before:bg-info"],
        progress: [DOT, "before:bg-primary"],
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
