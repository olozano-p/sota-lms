import { Link, type LinkProps } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/cn";

export interface Crumb {
  label: string;
  link?: LinkProps;
}

/**
 * The head of every student page: a breadcrumb of labels («Courses / Course / Chapter») over the
 * serif title, with an optional row of meta labels or actions underneath.
 */
export function PageHeader({
  crumbs = [],
  title,
  meta,
  className,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <header className={cn("flex max-w-3xl flex-col gap-4", className)}>
      {crumbs.length ? (
        <nav aria-label={t("nav.breadcrumb")}>
          <ol className="label flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground/50">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 ? <li aria-hidden="true">/</li> : null}
                <li>
                  {c.link ? (
                    <Link
                      {...c.link}
                      className="text-foreground/50 no-underline hover:text-foreground hover:no-underline"
                    >
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1>{title}</h1>
      {meta ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{meta}</div> : null}
    </header>
  );
}
