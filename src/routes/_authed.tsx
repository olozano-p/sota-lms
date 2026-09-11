import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

/** Pathless layout: everything below needs a session; visitors go to the IdP and come back here. */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context, location }) => {
    if (!context.session.user) {
      throw redirect({ href: `/auth/login?returnTo=${encodeURIComponent(location.href)}` });
    }
    return { user: context.session.user };
  },
  component: Outlet,
});
