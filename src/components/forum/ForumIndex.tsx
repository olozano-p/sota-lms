import { useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useI18n } from "~/i18n";
import type { listThreads } from "~/server/queries/forum";
import { buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/cn";
import { ForumLink, forumPath } from "./links";
import { ThreadList } from "./ThreadList";

type Data = NonNullable<Awaited<ReturnType<typeof listThreads>>>;

/** The thread listing shared by the course forum tab and the general forum page. */
export function ForumIndex({
  data,
  courseSlug,
  q,
}: {
  data: Data;
  courseSlug: string | null;
  q: string | undefined;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          role="search"
          className="relative w-full max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            const value = (new FormData(e.currentTarget).get("q") as string).trim();
            void navigate({
              to: forumPath(courseSlug, { kind: "index" }),
              search: { q: value || undefined, page: undefined },
            });
          }}
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            type="search"
            defaultValue={q ?? ""}
            aria-label={t("forum.search.label")}
            placeholder={t("forum.search")}
            className="pl-9"
          />
        </form>
        <ForumLink
          courseSlug={courseSlug}
          dest={{ kind: "new" }}
          className={cn(
            buttonVariants(),
            "text-primary-foreground no-underline hover:no-underline",
          )}
        >
          <Plus aria-hidden="true" />
          {t("forum.newThread")}
        </ForumLink>
      </div>

      <ThreadList threads={data.threads} courseSlug={courseSlug} q={q} />

      {data.pageCount > 1 ? (
        <nav
          aria-label={t("forum.pagination")}
          className="flex items-center justify-between text-sm"
        >
          {data.page > 1 ? (
            <ForumLink courseSlug={courseSlug} dest={{ kind: "index", page: data.page - 1, q }}>
              ← {t("forum.prev")}
            </ForumLink>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground tabular-nums">
            {t("forum.page", { page: data.page, total: data.pageCount })}
          </span>
          {data.page < data.pageCount ? (
            <ForumLink courseSlug={courseSlug} dest={{ kind: "index", page: data.page + 1, q }}>
              {t("forum.next")} →
            </ForumLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
