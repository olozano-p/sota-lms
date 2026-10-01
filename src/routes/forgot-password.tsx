import { useState, type FormEvent } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { AuthLayout } from "~/components/auth/AuthLayout";
import { authClient } from "~/components/auth/client";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: ({ context }) => {
    if (context.auth.mode !== "local") throw notFound();
  },
  component: ForgotPage,
});

function ForgotPage() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await authClient.requestPasswordReset({
        email: String(form.get("email") ?? "").trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Neutral answer on purpose: the reply never says whether the address is registered.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <AuthLayout title={t("auth.forgot.title")} lead={t("auth.forgot.lead")}>
      {sent ? (
        <Alert variant="success" title={t("auth.forgot.sent")} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("auth.email")}>
            {(c) => (
              <Input {...c} name="email" type="email" autoComplete="email" required autoFocus />
            )}
          </Field>
          <Button type="submit" loading={busy} className="self-start">
            {t("auth.forgot.submit")}
          </Button>
        </form>
      )}
      <Link to="/login" className="text-sm">
        {t("auth.backToLogin")}
      </Link>
    </AuthLayout>
  );
}
