import { createFileRoute, notFound } from "@tanstack/react-router";
import { getThread } from "~/server/queries/forum";
import { ThreadView } from "~/components/forum/ThreadView";

export const Route = createFileRoute("/_authed/forum/$threadId")({
  loader: async ({ params }) => {
    const data = await getThread({ data: { threadId: params.threadId } });
    if (!data || data.scope.kind !== "general") throw notFound();
    return data;
  },
  component: ThreadPage,
});

function ThreadPage() {
  const data = Route.useLoaderData();
  return <ThreadView key={data.thread.id} data={data} courseSlug={null} />;
}
