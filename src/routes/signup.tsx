import { useState, type FormEvent } from "react";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { AuthLayout } from "~/components/auth/AuthLayout";
import { authClient, MIN_PASSWORD_LENGTH } from "~/components/auth/client";
import { authErrorKey } from "~/components/auth/errors";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export const Route = createFileRoute("/signup")({
  beforeLoad: ({ context }) => {
    if (context.auth.mode !== "local" || !context.auth.signupOpen) throw notFound();
    if (context.session.user) throw redirect({ to: "/courses" });
  },
  component: SignupPage,
});

function SignupPage() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.signUp.email({
        name: String(form.get("name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        callbackURL: "/courses",
      });
      if (err) setError(t(authErrorKey(err)));
      else setSent(true);
    } catch {
      setError(t("auth.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t("auth.signup.title")} lead={t("auth.signup.lead")}>
      {sent ? (
        <Alert variant="success" title={t("auth.signup.sent")} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? <Alert variant="destructive" title={error} /> : null}
          <Field label={t("auth.name")}>
            {(c) => <Input {...c} name="name" autoComplete="name" required autoFocus />}
          </Field>
          <Field label={t("auth.email")}>
            {(c) => <Input {...c} name="email" type="email" autoComplete="email" required />}
          </Field>
          <Field
            label={t("auth.password")}
            description={t("auth.passwordHint", { n: MIN_PASSWORD_LENGTH })}
          >
            {(c) => (
              <Input
                {...c}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            )}
          </Field>
          <Button type="submit" loading={busy} className="self-start">
            {t("auth.signup.submit")}
          </Button>
        </form>
      )}
      <p className="text-sm text-muted-foreground">
        {t("auth.signup.haveAccount")} <Link to="/login">{t("auth.login.title")}</Link>
      </p>
    </AuthLayout>
  );
}
