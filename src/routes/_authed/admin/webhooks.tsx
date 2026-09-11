import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { listWebhookEvents } from "~/server/queries/admin";
import { Badge } from "~/components/ui/badge";
import { Empty } from "~/components/ui/empty";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";

export const Route = createFileRoute("/_authed/admin/webhooks")({
  loader: () => listWebhookEvents(),
  component: WebhooksPage,
});

function WebhooksPage() {
  const { t, fmtDateTime } = useI18n();
  const events = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("admin.webhooks.lead")}</p>
      {events.length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{t("admin.webhooks.received")}</Th>
              <Th>{t("admin.webhooks.event")}</Th>
              <Th>{t("admin.webhooks.subject")}</Th>
              <Th>{t("admin.webhooks.result")}</Th>
              <Th>{t("admin.webhooks.payload")}</Th>
            </tr>
          </THead>
          <TBody>
            {events.map((e) => {
              const payload = JSON.parse(e.payload) as { sub?: string };
              return (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(e.receivedAt)}</Td>
                  <Td>
                    <div>{e.eventType}</div>
                    <div className="font-mono text-xs text-muted-foreground">{e.externalId}</div>
                  </Td>
                  <Td className="font-mono text-xs">{payload.sub ?? "—"}</Td>
                  <Td>
                    {e.error ? (
                      <Badge variant="destructive" title={e.error}>
                        {t("admin.webhooks.error")}
                      </Badge>
                    ) : e.processedAt ? (
                      <Badge variant="success">{t("admin.webhooks.ok")}</Badge>
                    ) : (
                      <Badge variant="warning">{t("admin.webhooks.pending")}</Badge>
                    )}
                    {e.error ? (
                      <div className="mt-1 max-w-xs text-xs text-muted-foreground">{e.error}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {t("admin.webhooks.payload")}
                      </summary>
                      <pre className="mt-2 max-w-md overflow-x-auto rounded bg-code p-2 font-mono text-xs">
                        {JSON.stringify(JSON.parse(e.payload), null, 2)}
                      </pre>
                    </details>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
