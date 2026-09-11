import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "~/i18n";
import { Button } from "~/components/ui/button";

export interface UploadedFile {
  key: string;
  filename: string;
  mime: string;
  size: number;
}

interface UploadFieldProps {
  accept: string[];
  maxBytes: number;
  current: { key: string } | null;
  /** Asks the server for a presigned PUT. */
  request: (f: {
    filename: string;
    mime: string;
    size: number;
  }) => Promise<{ url: string; key: string }>;
  /** Tells the server the PUT is done; it HEADs the object and records the file. */
  confirm: (key: string, filename: string) => Promise<UploadedFile>;
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
      const mime = f.type || "application/octet-stream";
      const { url, key } = await request({ filename: f.name, mime, size: f.size });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("content-type", mime);
        xhr.upload.onprogress = (e) =>
          e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error("upload failed"));
        xhr.send(f);
      });
      onUploaded(await confirm(key, f.name));
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
