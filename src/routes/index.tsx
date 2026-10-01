import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "~/i18n";
import { Alert } from "~/components/ui/alert";
import { buttonVariants } from "~/components/ui/button";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ error: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.session.user) throw redirect({ to: "/courses" });
  },
  component: Landing,
});

function Landing() {
  const { t } = useI18n();
  const { error } = Route.useSearch();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-6 py-16">
      {error === "login" ? <Alert variant="destructive" title={t("auth.error.login")} /> : null}
      <h1 className="text-4xl leading-tight">{t("home.title")}</h1>
      <p className="text-lg text-muted-foreground">{t("home.lead")}</p>
      <a
        href="/auth/login"
        className={
          buttonVariants({ size: "lg" }) +
          " text-primary-foreground no-underline hover:no-underline"
        }
      >
        {t("home.cta")}
      </a>
    </div>
  );
}
