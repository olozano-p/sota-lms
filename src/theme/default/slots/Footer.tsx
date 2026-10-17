import { useI18n } from "~/i18n";
import type { FooterProps } from "~/theme/slots";

/** Name, legal links and support address on the left; the SOTA credit on the right. */
export default function Footer({ brand }: FooterProps) {
  const { t } = useI18n();
  return (
    <footer className="label flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-6 text-foreground/50 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>{brand.name}</span>
        {brand.legalLinks.map((l) => (
          <a key={l.href} href={l.href} className="text-foreground/50">
            {l.label}
          </a>
        ))}
        {brand.supportEmail ? (
          <a href={`mailto:${brand.supportEmail}`} className="text-foreground/50">
            {brand.supportEmail}
          </a>
        ) : null}
      </div>
      {brand.projectUrl ? (
        <a href={brand.projectUrl} className="text-foreground/50">
          {t("app.poweredBy")}
        </a>
      ) : (
        <span>{t("app.poweredBy")}</span>
      )}
    </footer>
  );
}
