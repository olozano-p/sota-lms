import { Lock, MessageSquare, Pin } from "lucide-react";
import { useI18n } from "~/i18n";
import type { listThreads } from "~/server/queries/forum";
import { Avatar } from "~/components/ui/avatar";
import { Empty } from "~/components/ui/empty";
import { Eyebrow } from "~/components/ui/eyebrow";
import { ForumLink } from "./links";
import { When } from "./When";

type Data = NonNullable<Awaited<ReturnType<typeof listThreads>>>;
type Thread = Data["threads"][number];

export function ThreadList({
  threads,
  courseSlug,
  q,
}: {
  threads: Thread[];
  courseSlug: string | null;
  q?: string;
}) {
  const { t } = useI18n();
  if (!threads.length) {
    return q ? (
      <Empty title={t("forum.empty.search", { q })} />
    ) : (
      <Empty title={t("forum.empty.title")}>{t("forum.empty.lead")}</Empty>
    );
  }
  const pinned = threads.filter((th) => th.pinned);
  const rest = threads.filter((th) => !th.pinned);
  return (
    <div className="flex flex-col gap-6">
      {pinned.length ? (
        <section className="flex flex-col gap-2">
          <Eyebrow>{t("forum.pinned")}</Eyebrow>
          <Rows threads={pinned} courseSlug={courseSlug} />
        </section>
      ) : null}
      {rest.length ? <Rows threads={rest} courseSlug={courseSlug} /> : null}
    </div>
  );
}

function Rows({ threads, courseSlug }: { threads: Thread[]; courseSlug: string | null }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col divide-y rounded-lg border bg-card">
      {threads.map((th) => (
        <li key={th.id} className="flex gap-4 px-4 py-3.5 sm:px-5">
          <Avatar name={th.author.name || t("forum.unknownAuthor")} className="mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {th.pinned ? (
                <Pin className="size-3.5 text-muted-foreground" aria-label={t("forum.pinned")} />
              ) : null}
              {th.locked ? (
                <Lock className="size-3.5 text-muted-foreground" aria-label={t("forum.locked")} />
              ) : null}
              <ForumLink
                courseSlug={courseSlug}
                dest={{ kind: "thread", threadId: th.id }}
                className="font-medium text-foreground no-underline hover:underline"
              >
                {th.title}
              </ForumLink>
            </div>
            {th.excerpt ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">{th.excerpt}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("forum.started", { name: th.author.name || t("forum.unknownAuthor") })}{" "}
              <When date={th.createdAt} />
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {th.replies === 1 ? t("forum.replies.one") : t("forum.replies", { n: th.replies })}
            </span>
            <span className="hidden sm:inline">
              <When date={th.lastActivityAt} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
