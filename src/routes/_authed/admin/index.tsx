import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "~/i18n";
import { listPeople } from "~/server/queries/admin";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";
import { Empty } from "~/components/ui/empty";
import { RoleBadges } from "~/components/admin/RoleBadges";

export const Route = createFileRoute("/_authed/admin/")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) => listPeople({ data: { q: deps.q } }),
  component: PeoplePage,
});

function PeoplePage() {
  const { t, fmtRelative, fmtDateTime } = useI18n();
  const people = Route.useLoaderData();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex w-full max-w-sm flex-col gap-1">
          <span className="sr-only">{t("common.search")}</span>
          <Input
            type="search"
            placeholder={t("admin.people.search")}
            defaultValue={q ?? ""}
            onChange={(e) =>
              navigate({ search: { q: e.target.value || undefined }, replace: true })
            }
          />
        </label>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("admin.people.count", { n: people.length })}
        </span>
      </div>
      {people.length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{t("common.name")}</Th>
              <Th>{t("admin.people.roles")}</Th>
              <Th className="text-right">{t("admin.people.entitlements")}</Th>
              <Th>{t("admin.people.lastSeen")}</Th>
              <Th>{t("admin.people.synced")}</Th>
            </tr>
          </THead>
          <TBody>
            {people.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Link
                    to="/admin/people/$personId"
                    params={{ personId: p.id }}
                    className="font-medium text-foreground"
                  >
                    {p.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{p.email}</div>
                </Td>
                <Td>
                  <RoleBadges roles={p.roles} />
                </Td>
                <Td className="text-right tabular-nums">{p.entitlementCount}</Td>
                <Td
                  className="text-muted-foreground"
                  title={p.lastSeenAt ? fmtDateTime(p.lastSeenAt) : undefined}
                >
                  {p.lastSeenAt ? fmtRelative(p.lastSeenAt) : t("admin.people.never")}
                </Td>
                <Td className="text-muted-foreground">
                  {p.entitlementsSyncedAt ? (
                    fmtRelative(p.entitlementsSyncedAt)
                  ) : (
                    <Badge variant="warning">{t("admin.people.never")}</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
