import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/i18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Without a confirm label the dialog is informational: only «Back» is offered. */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** Destructive confirmations get a red action and keep the initial focus on the safe button. */
  destructive?: boolean;
  /** While true the dialog cannot be dismissed. */
  loading?: boolean;
  onClose: () => void;
  children?: ReactNode;
}

// Native <dialog> in modal mode: the browser supplies the top layer, the focus trap, Escape and
// the ::backdrop; we only mirror the `open` prop into showModal()/close().
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  loading = false,
  onClose,
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      if (!destructive) confirmRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, destructive]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? "confirm-dialog-description" : undefined}
      onClose={onClose}
      onCancel={(e) => {
        if (loading) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
      className={[
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border bg-card p-0 text-card-foreground",
        "backdrop:bg-foreground/40",
        "transition-opacity duration-[120ms] ease-(--ease) starting:open:opacity-0",
        "backdrop:transition-opacity backdrop:duration-[120ms] starting:open:backdrop:opacity-0",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <h2 id="confirm-dialog-title" className="text-base leading-snug">
            {title}
          </h2>
          {description ? (
            <p id="confirm-dialog-description" className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {children}
        <div className="flex flex-wrap-reverse justify-end gap-2">
          <Button variant="outline" disabled={loading} onClick={onClose}>
            {t("common.back")}
          </Button>
          {confirmLabel && onConfirm ? (
            <Button
              ref={confirmRef}
              variant={destructive ? "destructive" : "default"}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
