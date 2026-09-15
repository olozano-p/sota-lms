import { createFileRoute, notFound } from "@tanstack/react-router";
import { listThreads } from "~/server/queries/forum";
import { NewThreadForm } from "~/components/forum/NewThreadForm";

export const Route = createFileRoute("/_authed/forum/new")({
  // The listing's gate doubles as the "may post here" check.
  loader: async () => {
    const data = await listThreads({ data: { courseSlug: null, page: 1 } });
    if (!data) throw notFound();
  },
  component: () => <NewThreadForm courseSlug={null} />,
});
