import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "~/lib/cn";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded font-medium",
    "transition-[background-color,color,border-color] duration-[120ms] ease-(--ease)",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    // A 44px hit area on coarse pointers regardless of the visual size (docs/DESIGN.md).
    "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:min-h-11 pointer-coarse:after:-translate-y-1/2",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border border-input bg-card text-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        destructive: "bg-destructive text-background hover:bg-destructive/90",
        link: "h-auto px-0 text-link underline-offset-[3px] hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        default: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-base",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
