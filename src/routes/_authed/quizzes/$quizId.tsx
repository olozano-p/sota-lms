import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { Empty } from "~/components/ui/empty";

export const Route = createFileRoute("/_authed/quizzes/$quizId")({
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-3xl">{t("lesson.quiz.title")}</h1>
      <Empty title={t("common.empty")} />
    </div>
  );
}
