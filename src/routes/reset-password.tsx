import { useState, type FormEvent } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "~/i18n";
import { AuthLayout } from "~/components/auth/AuthLayout";
import { authClient, MIN_PASSWORD_LENGTH } from "~/components/auth/client";
import { authErrorKey } from "~/components/auth/errors";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.auth.mode !== "local") throw notFound();
  },
  component: ResetPage,
});

function ResetPage() {
  const { t } = useI18n();
  const { token, error: linkError } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError(t("auth.error.passwordMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.resetPassword({ newPassword: password, token });
      if (err) setError(t(authErrorKey(err)));
      else setDone(true);
    } catch {
      setError(t("auth.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const invalid = !token || linkError;
  return (
    <AuthLayout title={t("auth.reset.title")}>
      {done ? (
        <Alert variant="success" title={t("auth.reset.done")} />
      ) : invalid ? (
        <Alert variant="destructive" title={t("auth.error.invalidToken")} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? <Alert variant="destructive" title={error} /> : null}
          <Field
            label={t("auth.passwordNew")}
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
                autoFocus
              />
            )}
          </Field>
          <Field label={t("auth.passwordConfirm")}>
            {(c) => (
              <Input
                {...c}
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            )}
          </Field>
          <Button type="submit" loading={busy} className="self-start">
            {t("auth.reset.submit")}
          </Button>
        </form>
      )}
      <Link to="/login" className="text-sm">
        {t("auth.backToLogin")}
      </Link>
    </AuthLayout>
  );
}
