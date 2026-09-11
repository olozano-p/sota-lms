import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Upload } from "lucide-react";
import { useI18n } from "~/i18n";
import { confirmUpload, requestUpload } from "~/server/mutations/authoring";
import { Button } from "~/components/ui/button";

interface UploadFieldProps {
  courseId: string;
  accept: string[];
  maxBytes: number;
  current: { title: string; key: string } | null;
  onUploaded: (file: { key: string; filename: string; mime: string; size: number }) => void;
}

/** Presigned PUT straight to object storage; the server records the file after a HEAD. */
export function UploadField({ courseId, accept, maxBytes, current, onUploaded }: UploadFieldProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useServerFn(requestUpload);
  const confirm = useServerFn(confirmUpload);

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
      const { url, key } = await request({
        data: {
          courseId,
          filename: f.name,
          mime: f.type || "application/octet-stream",
          size: f.size,
        },
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("content-type", f.type || "application/octet-stream");
        xhr.upload.onprogress = (e) =>
          e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error("upload failed"));
        xhr.send(f);
      });
      const rec = await confirm({ data: { courseId, key, filename: f.name } });
      onUploaded(rec);
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
              : t("teach.block.file.upload")}
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
