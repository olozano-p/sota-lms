import { Check, Loader2 } from "lucide-react";
import { useI18n } from "~/i18n";
import type { SaveState } from "./useAutosave";

export function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useI18n();
  if (state.kind === "idle") return <span className="min-h-5 text-xs" />;
  if (state.kind === "saving")
    return (
      <span
        className="inline-flex min-h-5 items-center gap-1 text-xs text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" /> {t("teach.saving")}
      </span>
    );
  if (state.kind === "saved")
    return (
      <span
        className="inline-flex min-h-5 items-center gap-1 text-xs text-muted-foreground"
        role="status"
      >
        <Check className="size-3 text-success" aria-hidden="true" /> {t("teach.saved")}
      </span>
    );
  return (
    <span className="min-h-5 text-xs text-destructive-foreground" role="alert">
      {t("teach.saveError", { message: state.message })}
    </span>
  );
}
