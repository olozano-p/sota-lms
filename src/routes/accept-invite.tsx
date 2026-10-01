import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "~/i18n";
import { AuthLayout } from "~/components/auth/AuthLayout";
import { MIN_PASSWORD_LENGTH } from "~/components/auth/client";
import { authErrorKey } from "~/components/auth/errors";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: z.object({ token: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.auth.mode !== "local") throw notFound();
  },
  component: AcceptInvitePage,
});

type Preview =
  | { state: "loading" }
  | { state: "invalid" }
  | { state: "ok"; email: string; name: string };

function AcceptInvitePage() {
  const { t } = useI18n();
  const { token } = Route.useSearch();
  const [preview, setPreview] = useState<Preview>({ state: token ? "loading" : "invalid" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    fetch(`/api/auth/invite/preview?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid");
        return (await res.json()) as { email: string; name: string };
      })
      .then((p) => live && setPreview({ state: "ok", email: p.email, name: p.name }))
      .catch(() => live && setPreview({ state: "invalid" }));
    return () => {
      live = false;
    };
  }, [token]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError(t("auth.error.passwordMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, name: String(form.get("name") ?? "").trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        setError(t(authErrorKey({ ...body, status: res.status === 401 ? 400 : res.status })));
        return;
      }
      window.location.assign("/courses");
    } catch {
      setError(t("auth.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t("auth.invite.title")}
      lead={preview.state === "ok" ? t("auth.invite.lead", { email: preview.email }) : undefined}
    >
      {preview.state === "loading" ? (
        <p className="text-muted-foreground" role="status">
          {t("common.loading")}
        </p>
      ) : preview.state === "invalid" ? (
        <>
          <Alert variant="destructive" title={t("auth.error.invalidInvitation")} />
          <Link to="/login" className="text-sm">
            {t("auth.backToLogin")}
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? <Alert variant="destructive" title={error} /> : null}
          <Field label={t("auth.name")}>
            {(c) => (
              <Input {...c} name="name" autoComplete="name" defaultValue={preview.name} required />
            )}
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
            {t("auth.invite.submit")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
