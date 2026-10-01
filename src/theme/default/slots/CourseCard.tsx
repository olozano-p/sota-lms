import { Link } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { ProgressRule } from "~/components/ui/progress-rule";
import { cn } from "~/lib/cn";
import type { CourseCardProps } from "~/theme/slots";

/** One course in the catalogue grid. Renders an `<li>`: the route owns the surrounding `<ul>`. */
export default function CourseCard({ course: c }: CourseCardProps) {
  const { t } = useI18n();
  return (
    <li className="flex flex-col justify-between gap-4 rounded-lg border bg-card p-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {c.status === "draft" ? <Badge variant="warning">{t("courses.draft")}</Badge> : null}
          {c.status === "archived" ? <Badge>{t("courses.archived")}</Badge> : null}
          {c.privileged ? <Badge variant="info">{t("courses.teaching")}</Badge> : null}
        </div>
        <h2 className="font-serif text-xl font-medium tracking-normal">
          <Link
            to="/courses/$courseSlug"
            params={{ courseSlug: c.slug }}
            className="text-foreground"
          >
            {c.title}
          </Link>
        </h2>
        {c.subtitle ? <p className="text-sm text-muted-foreground">{c.subtitle}</p> : null}
        {c.lockMessage ? <p className="text-sm text-muted-foreground">{c.lockMessage}</p> : null}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {t("courses.progress", { completed: c.progress.completed, total: c.progress.total })}
          </span>
          <span>{t("common.percent", { n: Math.round(c.progress.ratio * 100) })}</span>
        </div>
        <ProgressRule value={c.progress.ratio} label={t("courses.progress.label")} />
        <div>
          <Link
            to="/courses/$courseSlug"
            params={{ courseSlug: c.slug }}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "text-foreground no-underline hover:no-underline",
            )}
          >
            {t("courses.open")}
          </Link>
        </div>
      </div>
    </li>
  );
}
