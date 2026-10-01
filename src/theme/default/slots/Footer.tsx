import { useI18n } from "~/i18n";
import type { FooterProps } from "~/theme/slots";

/** Name, legal links and support address on the left; the SOTA credit on the right. */
export default function Footer({ brand }: FooterProps) {
  const { t } = useI18n();
  return (
    <footer className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-5 text-xs text-muted-foreground sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>{brand.name}</span>
        {brand.legalLinks.map((l) => (
          <a key={l.href} href={l.href} className="text-muted-foreground">
            {l.label}
          </a>
        ))}
        {brand.supportEmail ? (
          <a href={`mailto:${brand.supportEmail}`} className="text-muted-foreground">
            {brand.supportEmail}
          </a>
        ) : null}
      </div>
      {brand.projectUrl ? (
        <a href={brand.projectUrl} className="text-muted-foreground">
          {t("app.poweredBy")}
        </a>
      ) : (
        <span>{t("app.poweredBy")}</span>
      )}
    </footer>
  );
}
