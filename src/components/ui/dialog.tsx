import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useI18n } from "~/i18n";

const dialogClass = [
  "m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border bg-card p-0 text-card-foreground",
  "backdrop:bg-foreground/40",
  "transition-opacity duration-[120ms] ease-(--ease) starting:open:opacity-0",
  "backdrop:transition-opacity backdrop:duration-[120ms] starting:open:backdrop:opacity-0",
].join(" ");

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
      className={dialogClass}
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

interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel: string;
  /** Returns an error message to keep the dialog open, or nothing to close it. */
  onConfirm: (value: string) => string | undefined | void;
  onClose: () => void;
}

/** One text input in a native modal dialog; the house alternative to `window.prompt`. */
export function PromptDialog({
  open,
  title,
  label,
  description,
  placeholder,
  defaultValue = "",
  confirmLabel,
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setError(null);
      if (inputRef.current) inputRef.current.value = defaultValue;
      el.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, defaultValue]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={dialogClass}
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const message = onConfirm(inputRef.current?.value.trim() ?? "");
          if (message) setError(message);
        }}
      >
        <h2 id={titleId} className="text-base leading-snug">
          {title}
        </h2>
        <Field label={label} description={description} error={error ?? undefined}>
          {(c) => (
            <Input
              {...c}
              ref={inputRef}
              type="text"
              inputMode="url"
              placeholder={placeholder}
              defaultValue={defaultValue}
              onChange={() => setError(null)}
            />
          )}
        </Field>
        <div className="flex flex-wrap-reverse justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}
