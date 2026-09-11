import type { ReactNode } from "react";

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-6 text-sm">
      <p className="font-medium">{title}</p>
      {children ? <div className="text-muted-foreground">{children}</div> : null}
    </div>
  );
}
