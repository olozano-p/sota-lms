import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "~/lib/cn";

const alertVariants = cva(
  "flex gap-3 rounded-lg border-l-2 bg-card px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-info [&>svg]:text-info",
        success: "border-success [&>svg]:text-success",
        warning: "border-warning [&>svg]:text-warning",
        destructive: "border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
} as const;

interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title?: string;
  children?: ReactNode;
}

export function Alert({ className, variant = "info", title, children, ...props }: AlertProps) {
  const Icon = icons[variant ?? "info"];
  return (
    <div
      role={variant === "destructive" || variant === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
