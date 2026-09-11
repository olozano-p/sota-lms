import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { Empty } from "~/components/ui/empty";

export const Route = createFileRoute("/_authed/courses/")({
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">{t("nav.courses")}</h1>
      <Empty title={t("common.empty")} />
    </div>
  );
}
