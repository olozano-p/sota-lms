import type { LoginPageProps } from "~/theme/slots";

/** The white panel every sign-in screen shares, centred on the page. */
export default function LoginPage({ title, lead, children }: LoginPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-lg bg-card p-6 sm:mt-10 sm:p-8">
      <div className="flex flex-col gap-3">
        <h1>{title}</h1>
        {lead ? <p className="font-serif text-sm text-muted-foreground">{lead}</p> : null}
      </div>
      {children}
    </div>
  );
}
