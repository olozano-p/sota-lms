import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "~/i18n";
import { previewMarkdown } from "~/server/queries/teach";
import { Textarea } from "~/components/ui/input";
import { Markdown } from "~/components/player/Markdown";
import { cn } from "~/lib/cn";

interface MarkdownFieldProps {
  id?: string;
  value: string;
  onChange: (md: string) => void;
  onBlur: () => void;
  rows?: number;
  className?: string;
}

/** Textarea with a preview tab rendered by the server's sanitiser (one Markdown path for everyone). */
export function MarkdownField({
  id,
  value,
  onChange,
  onBlur,
  rows = 12,
  className,
}: MarkdownFieldProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [html, setHtml] = useState<string | null>(null);
  const preview = useServerFn(previewMarkdown);

  useEffect(() => {
    if (mode !== "preview") return;
    let cancelled = false;
    preview({ data: { md: value } }).then((r) => {
      if (!cancelled) setHtml(r.html);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, value, preview]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div role="tablist" className="flex gap-1 text-xs">
        {(["write", "preview"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "min-h-7 rounded px-2 transition-colors duration-[120ms] ease-(--ease)",
              mode === m
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "write" ? t("teach.block.text.write") : t("teach.block.text.preview")}
          </button>
        ))}
      </div>
      {mode === "write" ? (
        <Textarea
          id={id}
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="font-mono text-[0.875rem]"
          spellCheck
        />
      ) : (
        <div className="min-h-24 rounded border bg-card p-4">
          {html === null ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <Markdown html={html} />
          )}
        </div>
      )}
    </div>
  );
}
