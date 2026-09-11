import { useState, type ReactNode } from "react";
import {
  createRootRoute,
  ErrorComponent,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { lmsConfig } from "~/config";
import { I18nProvider, useI18n, type Locale } from "~/i18n";
import { getLocale } from "~/server/locale";
import { getSession } from "~/server/auth/session";
import { AppShell } from "~/components/shell/AppShell";
import { AccountNav } from "~/components/shell/AccountNav";
import { THEME_BOOT_SCRIPT } from "~/components/shell/ThemeToggle";
import { brandStyle } from "~/components/shell/BrandStyle";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";

interface RootSearch {
  lang?: string;
}

const brandCss = brandStyle(lmsConfig.brand.colors);

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch =>
    typeof search.lang === "string" ? { lang: search.lang } : {},
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: lmsConfig.brand.name },
      { name: "application-name", content: lmsConfig.brand.name },
      { name: "color-scheme", content: "light dark" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [{ children: THEME_BOOT_SCRIPT }],
    styles: brandCss ? [{ children: brandCss }] : [],
  }),
  // The session lands in the router context so every child route can guard on it.
  beforeLoad: async () => ({ session: await getSession() }),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ context, deps }): Promise<{ locale: Locale }> => ({
    locale: await getLocale({
      data: { lang: deps.lang, claim: context.session.user?.locale ?? null },
    }),
  }),
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const { locale } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 2000 } } }),
  );
  return (
    <RootDocument lang={locale}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale={locale} timeZone={lmsConfig.timeZone}>
          <AppShell
            brand={lmsConfig.brand}
            locales={lmsConfig.locales.enabled}
            nav={<AccountNav user={session.user} />}
          >
            <Outlet />
          </AppShell>
        </I18nProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ lang, children }: Readonly<{ lang: string; children: ReactNode }>) {
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-16">
      <h1 className="text-3xl">{t("error.notFound.title")}</h1>
      <p className="text-muted-foreground">{t("error.notFound.lead")}</p>
      <Link
        to="/courses"
        className={cn(
          buttonVariants({ variant: "outline" }),
          "self-start text-foreground no-underline hover:no-underline",
        )}
      >
        {t("error.goHome")}
      </Link>
    </div>
  );
}

function RootError(props: ErrorComponentProps) {
  // The error boundary renders inside the shell only when the loader data is available.
  if (import.meta.env.DEV) return <ErrorComponent {...props} />;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-16">
      <h1 className="text-3xl">Error</h1>
      <p className="text-muted-foreground">{(props.error as Error).message}</p>
    </div>
  );
}
