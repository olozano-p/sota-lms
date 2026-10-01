import type { ReactNode } from "react";
import { Slot } from "~/components/theme/Slot";

/** Placeholder for a list with nothing in it; the look is the `EmptyState` theme slot. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Slot name="EmptyState" title={title}>
      {children}
    </Slot>
  );
}
