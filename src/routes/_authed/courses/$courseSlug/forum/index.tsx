import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { listThreads } from "~/server/queries/forum";
import { ForumIndex } from "~/components/forum/ForumIndex";

const search = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/courses/$courseSlug/forum/")({
  validateSearch: search,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, q: search.q }),
  loader: async ({ params, deps }) => {
    const data = await listThreads({
      data: { courseSlug: params.courseSlug, page: deps.page, q: deps.q },
    });
    if (!data) throw notFound();
    return data;
  },
  component: CourseForumPage,
});

function CourseForumPage() {
  const data = Route.useLoaderData();
  const { courseSlug } = Route.useParams();
  const { q } = Route.useSearch();
  return <ForumIndex data={data} courseSlug={courseSlug} q={q} />;
}
