import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { listAuditLog } from "~/server/queries/admin";
import { Empty } from "~/components/ui/empty";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";

export const Route = createFileRoute("/_authed/admin/audit")({
  loader: () => listAuditLog(),
  component: AuditPage,
});

function AuditPage() {
  const { t, fmtDateTime } = useI18n();
  const rows = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("admin.audit.lead")}</p>
      {rows.length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{t("admin.audit.when")}</Th>
              <Th>{t("admin.audit.actor")}</Th>
              <Th>{t("admin.audit.action")}</Th>
              <Th>{t("admin.audit.entity")}</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.at)}</Td>
                <Td>
                  {r.actorName ?? (
                    <span className="text-muted-foreground">{t("admin.audit.system")}</span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td>
                  <span>{r.entity}</span>
                  {r.entityId ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {r.entityId}
                    </span>
                  ) : null}
                  {r.diff ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        diff
                      </summary>
                      <pre className="mt-1 max-w-md overflow-x-auto rounded bg-code p-2 font-mono text-xs">
                        {JSON.stringify(JSON.parse(r.diff), null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
