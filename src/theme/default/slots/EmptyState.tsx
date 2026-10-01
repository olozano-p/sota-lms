import type { EmptyStateProps } from "~/theme/slots";

export default function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-6 text-sm">
      <p className="font-medium">{title}</p>
      {children ? <div className="text-muted-foreground">{children}</div> : null}
    </div>
  );
}
