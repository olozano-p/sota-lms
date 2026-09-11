import { Lock } from "lucide-react";
import type { Decision } from "~/server/access/rules";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/cn";

/** Lock reasons are i18n'd from the rule type, never from an organisation's tier names. */
export function lockMessage(decision: Decision, i18n: ReturnType<typeof useI18n>): string | null {
  if (decision.ok) return null;
  const { t, fmtDate, fmtDateTime } = i18n;
  switch (decision.reason) {
    case "not_yet_released": {
      const at = decision.availableAt!;
      const midnight = at.getUTCHours() === 22 || at.getUTCHours() === 23 || at.getUTCHours() === 0;
      return t("lock.not_yet_released", { date: midnight ? fmtDate(at) : fmtDateTime(at) });
    }
    case "expired":
      return t("lock.expired", { date: fmtDate(decision.expiredOn!) });
    default:
      return t(`lock.${decision.reason}`);
  }
}

export function LockNotice({ decision, className }: { decision: Decision; className?: string }) {
  const i18n = useI18n();
  const message = lockMessage(decision, i18n);
  if (!message) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-dashed p-5 text-sm",
        className,
      )}
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{i18n.t("lock.title")}</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
