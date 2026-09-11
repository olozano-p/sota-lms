import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/** Tabs are links: the selected tab is a fact of the URL, not component state. */
export function Tabs({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {children}
    </nav>
  );
}

export function Tab({ children, ...props }: LinkProps & { children: ReactNode }) {
  return (
    <Link
      {...props}
      className={cn(
        "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground no-underline",
        "transition-colors duration-[120ms] ease-(--ease) hover:text-foreground hover:no-underline",
        "[&.active]:border-primary [&.active]:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
