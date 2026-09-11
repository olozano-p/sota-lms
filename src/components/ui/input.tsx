import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export const inputClass = cn(
  "flex w-full min-w-0 rounded border border-input bg-card px-3 text-sm text-foreground",
  "placeholder:text-muted-foreground",
  "transition-[border-color] duration-[120ms] ease-(--ease)",
  "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
  "aria-invalid:border-destructive",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = "text", ...props }, ref) {
    return (
      <input ref={ref} type={type} className={cn(inputClass, "h-10 py-2", className)} {...props} />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(inputClass, "min-h-24 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  );
});
