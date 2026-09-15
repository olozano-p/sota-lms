import { createFileRoute, notFound } from "@tanstack/react-router";
import { getThread } from "~/server/queries/forum";
import { ThreadView } from "~/components/forum/ThreadView";

export const Route = createFileRoute("/_authed/courses/$courseSlug/forum/$threadId")({
  loader: async ({ params }) => {
    const data = await getThread({ data: { threadId: params.threadId } });
    if (!data || data.scope.course?.slug !== params.courseSlug) throw notFound();
    return data;
  },
  component: CourseThreadPage,
});

function CourseThreadPage() {
  const data = Route.useLoaderData();
  const { courseSlug } = Route.useParams();
  return <ThreadView key={data.thread.id} data={data} courseSlug={courseSlug} />;
}
