import { useI18n } from "~/i18n";
import { Alert } from "~/components/ui/alert";
import { buttonVariants } from "~/components/ui/button";
import type { HomeProps } from "~/theme/slots";

/** The signed-out landing: title, lead, and the one filled button that starts sign-in. */
export default function Home({ brand, loginFailed, loginHref }: HomeProps) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-6 py-16">
      {loginFailed ? <Alert variant="destructive" title={t("auth.error.login")} /> : null}
      <h1 className="text-4xl leading-tight">{t("home.title")}</h1>
      {brand.tagline ? <p className="text-xl">{brand.tagline}</p> : null}
      <p className="text-lg text-muted-foreground">{t("home.lead")}</p>
      <a
        href={loginHref}
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
