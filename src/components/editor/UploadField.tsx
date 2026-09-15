import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "~/i18n";
import { Button } from "~/components/ui/button";
import { uploadFile, type UploadAdapter, type UploadedFile } from "./upload";

export type { UploadedFile } from "./upload";

interface UploadFieldProps extends UploadAdapter {
  current: { key: string } | null;
  onUploaded: (file: UploadedFile) => void;
  label?: string;
}

/** Presigned PUT straight to object storage from the browser; used by teachers and by students' submissions. */
export function UploadField({
  accept,
  maxBytes,
  current,
  request,
  confirm,
  onUploaded,
  label,
}: UploadFieldProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (f: File) => {
    setError(null);
    if (f.size > maxBytes) {
      setError(
        t("teach.block.file.limits", {
          mb: Math.round(maxBytes / 1_048_576),
          types: accept.join(", "),
        }),
      );
      return;
    }
    setPct(0);
    try {
      onUploaded(await uploadFile({ accept, maxBytes, request, confirm }, f, setPct));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPct(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          className="sr-only"
          accept={accept.join(",")}
          aria-label={label ?? t("teach.block.file.upload")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.current?.click()}
          loading={pct !== null}
        >
          <Upload aria-hidden="true" />
          {pct !== null
            ? t("teach.block.file.uploading", { pct })
            : current?.key
              ? t("teach.block.file.replace")
              : (label ?? t("teach.block.file.upload"))}
        </Button>
        {current?.key ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {current.key.split("/").at(-1)}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("teach.block.file.limits", {
          mb: Math.round(maxBytes / 1_048_576),
          types: accept.map((a) => a.split("/")[1]).join(", "),
        })}
      </p>
      {error ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
