import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

// A surface is a hairline on a slightly lighter fill; no shadow (docs/DESIGN.md).
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground", className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base leading-snug", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-3 border-t px-5 py-3", className)} {...props} />;
}
