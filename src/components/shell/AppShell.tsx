import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useI18n, type Locale } from "~/i18n";
import { BrandMark } from "~/components/shell/BrandMark";
import { LocaleSwitch } from "~/components/shell/LocaleSwitch";
import { ThemeToggle } from "~/components/shell/ThemeToggle";

interface AppShellProps {
  brand: { name: string; logo: string | null; projectUrl: string };
  locales: readonly Locale[];
  /** Right-hand side of the header: navigation and account controls. */
  nav?: ReactNode;
  children: ReactNode;
}

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
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link
            to="/"
            aria-label={brand.name}
            className="text-foreground no-underline hover:no-underline"
          >
            <span className="inline-flex items-center gap-2.5">
              <BrandMark logo={brand.logo} name={brand.name} className="text-primary" />
              <span className="font-serif text-lg leading-none">{brand.name}</span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            {nav}
            <LocaleSwitch enabled={locales} />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
        <span>{brand.name}</span>
        <a href={brand.projectUrl} className="text-muted-foreground">
          {t("app.poweredBy")}
        </a>
      </footer>
    </div>
  );
}
