import type { EmptyStateProps } from "~/theme/slots";

/** A quiet sand panel: what is missing, then why or what to do. */
export default function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-tint/40 p-6">
      <p className="label">{title}</p>
      {children ? <div className="font-serif text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
