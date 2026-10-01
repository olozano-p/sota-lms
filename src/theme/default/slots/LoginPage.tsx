import type { LoginPageProps } from "~/theme/slots";

/** The narrow centred column every sign-in screen shares. */
export default function LoginPage({ title, lead, children }: LoginPageProps) {
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
