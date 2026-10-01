import type { ReactNode } from "react";
import { useI18n, type Locale } from "~/i18n";
import { LocaleSwitch } from "~/components/shell/LocaleSwitch";
import { ThemeToggle } from "~/components/shell/ThemeToggle";
import { Slot } from "~/components/theme/Slot";
import type { ThemeBrand } from "~/theme/slots";

interface AppShellProps {
  brand: ThemeBrand;
  locales: readonly Locale[];
  /** Account menu or sign-in link, handed to the Header slot. */
  nav?: ReactNode;
  children: ReactNode;
}

/** Skip link, the Header slot, the content column and the Footer slot. */
export function AppShell({ brand, locales, nav, children }: AppShellProps) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
      >
        {t("app.skipToContent")}
      </a>
      <Slot
        name="Header"
        brand={brand}
        nav={nav}
        localeSwitch={<LocaleSwitch enabled={locales} />}
        themeToggle={<ThemeToggle />}
      />
      <main id="content" className="mx-auto w-full max-w-content flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <Slot name="Footer" brand={brand} />
    </div>
  );
}
