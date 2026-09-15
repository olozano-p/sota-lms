import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { useI18n } from "~/i18n";
import type { BlockType } from "~/db/schema";
import { confirmUpload, requestUpload, resolveVideo } from "~/server/mutations/authoring";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Eyebrow } from "~/components/ui/eyebrow";
import { RichTextField } from "./RichTextField";
import { UploadField } from "./UploadField";

export interface EditableBlock {
  id: string;
  sort: number;
  type: BlockType;
  payload: Record<string, unknown>;
}

interface BlockEditorProps {
  block: EditableBlock;
  courseId: string;
  uploads: { maxBytes: number; allowedMime: string[] };
  embedAllowlist: string[];
  assignments: { id: string; title: string }[];
  quizzes: { id: string; title: string; kind: string }[];
  onChange: (payload: Record<string, unknown>) => void;
  onSave: () => void;
  onDelete: () => void;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function BlockEditor({
  block,
  courseId,
  uploads,
  embedAllowlist,
  assignments,
  quizzes,
  onChange,
  onSave,
  onDelete,
}: BlockEditorProps) {
  const { t } = useI18n();
  const p = block.payload;
  const set = (patch: Record<string, unknown>) => onChange({ ...p, ...patch });
  const setAndSave = (patch: Record<string, unknown>) => {
    onChange({ ...p, ...patch });
    queueMicrotask(onSave);
  };
  const resolve = useServerFn(resolveVideo);
  const request = useServerFn(requestUpload);
  const confirm = useServerFn(confirmUpload);
  const [videoInput, setVideoInput] = useState(str(p.external_id));
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const audioMime = uploads.allowedMime.filter((m) => m.startsWith("audio/"));
  const imageUpload = {
    accept: uploads.allowedMime.filter((m) => m.startsWith("image/")),
    maxBytes: uploads.maxBytes,
    request: (f: { filename: string; mime: string; size: number }) =>
      request({ data: { courseId, inline: true, ...f } }),
    confirm: (key: string, filename: string) => confirm({ data: { courseId, key, filename } }),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{t(`teach.block.type.${block.type}`)}</Eyebrow>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("teach.block.delete")}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      {block.type === "text" ? (
        <RichTextField
          value={str(p.md)}
          onChange={(md) => set({ md })}
          onBlur={onSave}
          upload={imageUpload}
          minHeightClass="min-h-48"
        />
      ) : null}

      {block.type === "video" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("teach.block.video.url")} className="sm:col-span-2">
            {(c) => (
              <div className="flex gap-2">
                <Input
                  {...c}
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder="https://vimeo.com/…"
                />
                <Button
                  type="button"
                  variant="outline"
                  loading={resolving}
                  onClick={async () => {
                    setResolving(true);
                    setResolveMsg(null);
                    try {
                      const meta = await resolve({
                        data: { courseId, provider: str(p.provider) || "vimeo", input: videoInput },
                      });
                      setAndSave({
                        provider: str(p.provider) || "vimeo",
                        external_id: meta.external_id,
                        title: str(p.title) || meta.title,
                        duration_s: meta.duration_s,
                        thumbnail_url: meta.thumbnail_url,
                      });
                      setVideoInput(meta.external_id);
                      setResolveMsg(t("teach.block.video.resolved", { title: meta.title }));
                    } catch (e) {
                      setResolveMsg((e as Error).message);
                    } finally {
                      setResolving(false);
                    }
                  }}
                >
                  {t("teach.block.video.resolve")}
                </Button>
              </div>
            )}
          </Field>
          {resolveMsg ? (
            <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
              {resolveMsg}
            </p>
          ) : null}
          <Field label={t("teach.block.video.title")}>
            {(c) => (
              <Input
                {...c}
                value={str(p.title)}
                onChange={(e) => set({ title: e.target.value })}
                onBlur={onSave}
              />
            )}
          </Field>
          <Field label={t("teach.block.video.duration")}>
            {(c) => (
              <Input
                {...c}
                type="number"
                min={0}
                value={typeof p.duration_s === "number" ? p.duration_s : ""}
                onChange={(e) =>
                  set({ duration_s: e.target.value === "" ? null : Number(e.target.value) })
                }
                onBlur={onSave}
              />
            )}
          </Field>
        </div>
      ) : null}

      {block.type === "audio" || block.type === "file" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("teach.block.file.title")} className="sm:col-span-2">
            {(c) => (
              <Input
                {...c}
                value={str(p.title)}
                onChange={(e) => set({ title: e.target.value })}
                onBlur={onSave}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <UploadField
              accept={block.type === "audio" ? audioMime : uploads.allowedMime}
              maxBytes={uploads.maxBytes}
              current={{ key: str(p.file_key) }}
              request={(f) => request({ data: { courseId, ...f } })}
              confirm={(key, filename) => confirm({ data: { courseId, key, filename } })}
              onUploaded={(f) =>
                block.type === "audio"
                  ? setAndSave({ file_key: f.key, title: str(p.title) || f.filename })
                  : setAndSave({
                      file_key: f.key,
                      title: str(p.title) || f.filename,
                      mime: f.mime,
                      size: f.size,
                    })
              }
            />
          </div>
        </div>
      ) : null}

      {block.type === "embed" ? (
        <Field
          label={t("teach.block.embed.url")}
          description={t("teach.block.embed.allowed", { hosts: embedAllowlist.join(", ") })}
        >
          {(c) => (
            <Input
              {...c}
              type="url"
              value={str(p.url)}
              onChange={(e) => set({ url: e.target.value })}
              onBlur={onSave}
              placeholder="https://"
            />
          )}
        </Field>
      ) : null}

      {block.type === "assignment" ? (
        <Field label={t("teach.block.assignment.pick")}>
          {(c) => (
            <Select
              {...c}
              value={str(p.assignment_id)}
              onChange={(e) => setAndSave({ assignment_id: e.target.value })}
            >
              <option value="">{t("teach.block.none")}</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      {block.type === "quiz" ? (
        <Field label={t("teach.block.quiz.pick")}>
          {(c) => (
            <Select
              {...c}
              value={str(p.quiz_id)}
              onChange={(e) => setAndSave({ quiz_id: e.target.value })}
            >
              <option value="">{t("teach.block.none")}</option>
              {quizzes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
    </div>
  );
}
