import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "~/i18n";
import { AuthLayout } from "~/components/auth/AuthLayout";
import { safeReturnPath } from "~/components/auth/client";
import { MagicLinkForm, PasswordSignInForm } from "~/components/auth/forms";
import { Alert } from "~/components/ui/alert";
import { buttonVariants } from "~/components/ui/button";

export const Route = createFileRoute("/login/")({
  validateSearch: z.object({ returnTo: z.string().optional(), error: z.string().optional() }),
  beforeLoad: ({ context, search }) => {
    if (context.session.user) throw redirect({ href: safeReturnPath(search.returnTo) });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();
  const { auth } = Route.useRouteContext();
  const { returnTo: rawReturnTo, error } = Route.useSearch();
  const returnTo = safeReturnPath(rawReturnTo);
  const errorText = error ? t(error === "login" ? "auth.error.login" : "auth.error.generic") : null;

  if (auth.mode === "oidc") {
    return (
      <AuthLayout title={t("auth.login.title")} lead={t("auth.oidc.lead")}>
        {errorText ? <Alert variant="destructive" title={errorText} /> : null}
        <a
          href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
          className={
            buttonVariants({ size: "lg" }) +
            " self-start text-primary-foreground no-underline hover:no-underline"
          }
        >
          {t("common.continue")}
        </a>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("auth.login.title")} lead={t("auth.login.lead")}>
      {errorText ? <Alert variant="destructive" title={errorText} /> : null}
      <PasswordSignInForm returnTo={returnTo} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link to="/forgot-password">{t("auth.login.forgot")}</Link>
        {auth.signupOpen ? <Link to="/signup">{t("auth.login.signup")}</Link> : null}
      </div>
      <MagicLinkForm returnTo={returnTo} />
    </AuthLayout>
  );
}
