import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LOCALE_NAMES, useI18n, type Locale } from "~/i18n";
import { setLocale } from "~/server/locale";
import { cn } from "~/lib/cn";

export function LocaleSwitch({ enabled }: { enabled: readonly Locale[] }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const change = useServerFn(setLocale);
  if (enabled.length < 2) return null;
  return (
    <div role="group" aria-label={t("locale.label")} className="flex items-center gap-0.5 text-xs">
      {enabled.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          title={LOCALE_NAMES[l]}
          onClick={async () => {
            if (l === locale) return;
            await change({ data: { locale: l } });
            await router.invalidate();
          }}
          className={cn(
            "min-h-8 rounded px-2 uppercase tracking-[0.06em] transition-colors duration-[120ms] ease-(--ease)",
            l === locale
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
