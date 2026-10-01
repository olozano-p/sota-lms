import { useState, type FormEvent } from "react";
import { useI18n } from "~/i18n";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { authClient } from "./client";
import { authErrorKey } from "./errors";

/** Email + password sign-in; a full navigation on success so the root session is read afresh. */
export function PasswordSignInForm({
  returnTo,
  primary = true,
}: {
  returnTo: string;
  primary?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.signIn.email({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (err) {
        setError(t(authErrorKey(err)));
        return;
      }
      window.location.assign(returnTo);
    } catch {
      setError(t("auth.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? <Alert variant="destructive" title={error} /> : null}
      <Field label={t("auth.email")}>
        {(c) => (
          <Input {...c} name="email" type="email" autoComplete="username" required autoFocus />
        )}
      </Field>
      <Field label={t("auth.password")}>
        {(c) => (
          <Input {...c} name="password" type="password" autoComplete="current-password" required />
        )}
      </Field>
      <Button
        type="submit"
        variant={primary ? "default" : "outline"}
        loading={busy}
        className="self-start"
      >
        {t("auth.login.submit")}
      </Button>
    </form>
  );
}

/** Magic link request. The answer is always the same neutral message, registered or not. */
export function MagicLinkForm({ returnTo }: { returnTo: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await authClient.signIn.magicLink({
        email: String(form.get("email") ?? "").trim(),
        callbackURL: returnTo,
      });
    } catch {
      // Deliberately silent: the reply must not reveal whether the address exists.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <section aria-labelledby="magic-title" className="flex flex-col gap-3 border-t pt-6">
      <h2 id="magic-title" className="text-base">
        {t("auth.magic.title")}
      </h2>
      {sent ? (
        <Alert variant="success" title={t("auth.magic.sent")} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("auth.email")}>
            {(c) => <Input {...c} name="email" type="email" autoComplete="email" required />}
          </Field>
          <Button type="submit" variant="outline" loading={busy} className="self-start">
            {t("auth.magic.submit")}
          </Button>
        </form>
      )}
    </section>
  );
}
