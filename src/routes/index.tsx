import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { Slot, useBrand } from "~/components/theme/Slot";

export const Route = createFileRoute("/")({
  // A failed sign-in lands on `/?error=login` and better-auth may append its own `error` code,
  // which arrives as an array.
  validateSearch: z.object({
    error: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .catch(undefined),
  }),
  beforeLoad: ({ context }) => {
    if (context.session.user) throw redirect({ to: "/courses" });
  },
  component: Landing,
});

function Landing() {
  const { error } = Route.useSearch();
  const brand = useBrand();
  return (
    <Slot name="Home" brand={brand} loginFailed={error !== undefined} loginHref="/auth/login" />
  );
}
