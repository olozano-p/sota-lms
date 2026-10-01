import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { AuthLayout } from "~/components/auth/AuthLayout";
import { PasswordSignInForm } from "~/components/auth/forms";

/** Exists only when BREAK_GLASS_ADMIN_EMAIL is set in oidc mode; never linked from anywhere. */
export const Route = createFileRoute("/login/break-glass")({
  beforeLoad: ({ context }) => {
    if (!context.auth.breakGlass) throw notFound();
    if (context.session.user) throw redirect({ to: "/courses" });
  },
  component: BreakGlass,
});

function BreakGlass() {
  const { t } = useI18n();
  return (
    <AuthLayout title={t("auth.breakGlass.title")} lead={t("auth.breakGlass.lead")}>
      <PasswordSignInForm returnTo="/admin" primary={false} />
    </AuthLayout>
  );
}
