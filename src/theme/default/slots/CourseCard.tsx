import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useI18n } from "~/i18n";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { BrandMark } from "~/components/shell/BrandMark";
import { useBrand } from "~/components/theme/Slot";
import { cn } from "~/lib/cn";
import type { CourseCardProps } from "~/theme/slots";

const STATE_BADGE = {
  in_progress: "progress",
  not_started: "outline",
  finished: "success",
  locked: "warning",
} as const;

/**
 * One course as a sand card: the cover on the left (stacked above on phones), then title, subtitle,
 * the chapter it is in and its state, and the link at the bottom. Renders an `<li>`: the route owns
 * the `<ul>`. A finished course has a faded cover and quiet text; its state word says why.
 */
export default function CourseCard({ course: c }: CourseCardProps) {
  const { t } = useI18n();
  const brand = useBrand();
  const finished = c.state === "finished";
  return (
    <li
      className={cn(
        "flex flex-col gap-6 rounded-lg bg-tint/40 p-2 sm:min-h-85 sm:flex-row",
        finished && "text-muted-foreground",
      )}
    >
      {c.coverUrl ? (
        <img
          src={c.coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "aspect-square w-full shrink-0 rounded object-cover sm:aspect-auto sm:w-75",
            finished && "opacity-50",
          )}
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex aspect-square w-full shrink-0 items-center justify-center rounded bg-tint text-muted-foreground sm:aspect-auto sm:w-75"
        >
          <BrandMark logo={null} name={brand.name} className="size-12" />
        </div>
      )}
      <div className="flex flex-1 flex-col justify-between gap-6 px-4 pb-4 sm:px-0 sm:py-6 sm:pr-4">
        <div className="flex flex-col gap-6">
          <h2 className="font-serif text-2xl leading-[1.2] font-medium tracking-normal">
            <Link
              to="/courses/$courseSlug"
              params={{ courseSlug: c.slug }}
              className="text-inherit no-underline hover:no-underline"
            >
              {c.title}
            </Link>
          </h2>
          {c.subtitle ? <p className="font-serif text-sm leading-[1.2]">{c.subtitle}</p> : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {c.position ? (
              <Badge>
                <Clock aria-hidden="true" />
                {t("courses.chapterOf", c.position)}
              </Badge>
            ) : null}
            <Badge variant={STATE_BADGE[c.state]}>
              {c.state === "locked" && c.lockMessage
                ? c.lockMessage
                : t(`courses.state.${c.state}`)}
            </Badge>
            {c.status === "draft" ? <Badge variant="warning">{t("courses.draft")}</Badge> : null}
            {c.privileged ? <Badge variant="info">{t("courses.teaching")}</Badge> : null}
          </div>
        </div>
        <Link
          to="/courses/$courseSlug"
          params={{ courseSlug: c.slug }}
          className={cn(buttonVariants({ variant: "link" }), "self-start")}
        >
          {finished ? t("courses.watchAgain") : t("courses.goTo")}
        </Link>
      </div>
    </li>
  );
}
