import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "~/i18n";
import { listThreads } from "~/server/queries/forum";
import { ForumIndex } from "~/components/forum/ForumIndex";

const search = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/forum/")({
  validateSearch: search,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, q: search.q }),
  loader: async ({ deps }) => {
    const data = await listThreads({ data: { courseSlug: null, page: deps.page, q: deps.q } });
    if (!data) throw notFound();
    return data;
  },
  component: GeneralForumPage,
});

function GeneralForumPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { q } = Route.useSearch();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl leading-tight">{t("forum.title")}</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t("forum.general.lead")}</p>
      </header>
      <ForumIndex data={data} courseSlug={null} q={q} />
    </div>
  );
}
