import { useId, type ReactNode } from "react";
import { cn } from "~/lib/cn";

interface FieldProps {
  label: string;
  hint?: string;
  description?: string;
  error?: string;
  className?: string;
  /** Receives the ids to wire `id`, `aria-describedby` and `aria-invalid` on the control. */
  children: (control: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  }) => ReactNode;
}

/** Label + control + description/error, with the aria wiring done once. */
export function Field({ label, hint, description, error, className, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>{label}</span>
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
