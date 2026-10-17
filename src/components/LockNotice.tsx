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
    <div className={cn("flex items-start gap-3 rounded-lg bg-tint/40 p-6", className)}>
      <Lock className="mt-px size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      <div className="flex flex-col gap-3">
        <p className="label text-muted-foreground">{i18n.t("lock.title")}</p>
        <p className="font-serif text-sm leading-[1.2]">{message}</p>
      </div>
    </div>
  );
}
