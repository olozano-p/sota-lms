import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "~/lib/cn";

// Dense, hairline-separated, zebra-free (docs/DESIGN.md).
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "text-left text-xs uppercase tracking-[0.06em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr]:border-t", className)} {...props} />;
}
export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("align-top", className)} {...props} />;
}
export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-3 py-2 font-medium", className)} {...props} />;
}
export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2", className)} {...props} />;
}
