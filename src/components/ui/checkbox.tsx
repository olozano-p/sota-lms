import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/cn";

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

/** Native checkbox with its label, sized for a thumb. */
export function Checkbox({ label, description, className, ...props }: ChoiceProps) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded-sm border-input accent-primary"
        {...props}
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}

export function Radio({ label, description, className, ...props }: ChoiceProps) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm", className)}>
      <input
        type="radio"
        className="mt-0.5 size-4 shrink-0 border-input accent-primary"
        {...props}
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}
