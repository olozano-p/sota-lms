import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { Tab, Tabs } from "~/components/ui/tabs";

/** Admin layout: role gate plus the three tabs. Non-admins get a 404, not a hint. */
export const Route = createFileRoute("/_authed/admin")({
  beforeLoad: ({ context }) => {
    if (!context.user.roles.includes("admin")) throw notFound();
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl">{t("admin.title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("admin.lead")}</p>
      </div>
      <Tabs label={t("admin.title")}>
        <Tab
          to="/admin"
          activeOptions={{ exact: false, includeSearch: false }}
          activeProps={{}}
          search={{}}
        >
          {t("admin.tabs.people")}
        </Tab>
        <Tab to="/admin/webhooks">{t("admin.tabs.webhooks")}</Tab>
        <Tab to="/admin/audit">{t("admin.tabs.audit")}</Tab>
      </Tabs>
      <Outlet />
    </div>
  );
}
