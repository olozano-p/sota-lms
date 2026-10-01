import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { Slot, useBrand } from "~/components/theme/Slot";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ error: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.session.user) throw redirect({ to: "/courses" });
  },
  component: Landing,
});

function Landing() {
  const { error } = Route.useSearch();
  const brand = useBrand();
  return <Slot name="Home" brand={brand} loginFailed={error === "login"} loginHref="/auth/login" />;
}
