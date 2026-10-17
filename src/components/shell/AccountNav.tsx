import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useI18n } from "~/i18n";
import { lmsConfig } from "~/config";
import type { SessionUser } from "~/server/auth/session";
import { cn } from "~/lib/cn";

// The stepper tags of the panels: a label at 60 %, the current section in a sand box.
const linkClass = cn(
  "label inline-flex h-8 items-center rounded-sm px-2 text-muted-foreground no-underline",
  "transition-colors duration-[120ms] ease-(--ease) hover:text-foreground hover:no-underline",
  "[&.active]:bg-tint [&.active]:text-foreground",
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
    <nav aria-label={t("nav.account")} className="flex flex-wrap items-center gap-1">
      <Link to="/courses" className={linkClass}>
        {t("nav.courses")}
      </Link>
      {lmsConfig.forum.general ? (
        <Link to="/forum" className={linkClass}>
          {t("nav.forum")}
        </Link>
      ) : null}
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
        <LogOut className="size-3.5" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">{t("nav.logout")}</span>
      </a>
    </nav>
  );
}
