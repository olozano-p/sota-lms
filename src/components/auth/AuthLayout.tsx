import type { ReactNode } from "react";
import { Slot, useBrand } from "~/components/theme/Slot";

/** The frame every sign-in screen shares; the look is the `LoginPage` theme slot. */
export function AuthLayout({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const brand = useBrand();
  return (
    <Slot name="LoginPage" brand={brand} title={title} lead={lead ?? null}>
      {children}
    </Slot>
  );
}
