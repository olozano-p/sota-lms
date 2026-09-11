import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "~/lib/cn";
import { inputClass } from "./input";

/** A native `<select>` in the Input's clothes — no popover library (ADR-008). */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(inputClass, "h-10", className)} {...props} />;
  },
);
