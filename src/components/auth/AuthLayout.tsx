import type { ReactNode } from "react";

/** The narrow centred column every sign-in screen shares. */
export function AuthLayout({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl">{title}</h1>
        {lead ? <p className="text-muted-foreground">{lead}</p> : null}
      </div>
      {children}
    </div>
  );
}
