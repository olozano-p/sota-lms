import { createFileRoute, notFound } from "@tanstack/react-router";
import { listThreads } from "~/server/queries/forum";
import { NewThreadForm } from "~/components/forum/NewThreadForm";

export const Route = createFileRoute("/_authed/courses/$courseSlug/forum/new")({
  loader: async ({ params }) => {
    const data = await listThreads({ data: { courseSlug: params.courseSlug, page: 1 } });
    if (!data) throw notFound();
  },
  component: NewCourseThreadPage,
});

function NewCourseThreadPage() {
  const { courseSlug } = Route.useParams();
  return <NewThreadForm courseSlug={courseSlug} />;
}
