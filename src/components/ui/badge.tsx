import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/cn";

// Status is never colour alone: the badge always carries its text. Square-ish, never a pill.
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-success/40 text-success-foreground",
        warning: "border-warning/50 text-warning-foreground",
        destructive: "border-destructive/40 text-destructive-foreground",
        info: "border-info/40 text-info-foreground",
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
