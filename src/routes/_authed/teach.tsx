import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";

/** Teacher layout: role gate. Course-level authorisation happens in each query/mutation. */
export const Route = createFileRoute("/_authed/teach")({
  beforeLoad: ({ context }) => {
    const roles = context.user.roles;
    if (!roles.includes("teacher") && !roles.includes("admin")) throw notFound();
  },
  component: Outlet,
});
