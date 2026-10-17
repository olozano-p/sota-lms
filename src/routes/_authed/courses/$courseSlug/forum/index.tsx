import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { listThreads } from "~/server/queries/forum";
import { useI18n } from "~/i18n";
import { ForumIndex } from "~/components/forum/ForumIndex";
import { PageHeader } from "~/components/ui/page-header";

const frame = getRouteApi("/_authed/courses/$courseSlug");

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
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { course } = frame.useLoaderData();
  const { q } = Route.useSearch();
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        crumbs={[
          { label: t("nav.courses"), link: { to: "/courses" } },
          {
            label: course.title,
            link: { to: "/courses/$courseSlug", params: { courseSlug: course.slug } },
          },
        ]}
        title={t("forum.title")}
      />
      <ForumIndex data={data} courseSlug={course.slug} q={q} />
    </div>
  );
}
