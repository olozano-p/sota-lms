import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useI18n } from "~/i18n";
import type { SessionUser } from "~/server/auth/session";
import { cn } from "~/lib/cn";

const linkClass = cn(
  "inline-flex min-h-8 items-center rounded px-2.5 text-sm text-muted-foreground no-underline",
  "transition-colors duration-[120ms] ease-(--ease) hover:bg-accent hover:text-foreground hover:no-underline",
  "[&.active]:text-foreground",
);

export function AccountNav({ user }: { user: SessionUser | null }) {
  const { t } = useI18n();
  if (!user) {
    return (
      <a href="/auth/login" className={linkClass}>
        {t("nav.login")}
      </a>
    );
  }
  const teaches = user.roles.includes("teacher") || user.roles.includes("admin");
  const admin = user.roles.includes("admin");
  return (
    <nav aria-label={t("nav.account")} className="flex items-center gap-0.5">
      <Link to="/courses" className={linkClass}>
        {t("nav.courses")}
      </Link>
      {teaches ? (
        <Link to="/teach" className={linkClass}>
          {t("nav.teach")}
        </Link>
      ) : null}
      {admin ? (
        <Link to="/admin" className={linkClass}>
          {t("nav.admin")}
        </Link>
      ) : null}
      <a
        href="/auth/logout"
        className={cn(linkClass, "gap-1.5")}
        title={t("app.signedInAs", { name: user.name })}
      >
        <LogOut className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">{t("nav.logout")}</span>
      </a>
    </nav>
  );
}
