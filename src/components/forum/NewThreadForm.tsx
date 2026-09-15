import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "~/i18n";
import { createThread } from "~/server/mutations/forum";
import { RichTextField } from "~/components/editor/RichTextField";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { ForumLink, forumPath } from "./links";
import { useForumUpload } from "./upload";

export function NewThreadForm({ courseSlug }: { courseSlug: string | null }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const create = useServerFn(createThread);
  const upload = useForumUpload(courseSlug);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (title.trim().length < 3) return setError(t("forum.thread.title.short"));
    if (!body.trim()) return setError(t("forum.reply.empty"));
    setBusy(true);
    try {
      const { id } = await create({ data: { courseSlug, title: title.trim(), bodyMd: body } });
      await navigate({ to: forumPath(courseSlug, { kind: "thread", threadId: id }) });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <ForumLink courseSlug={courseSlug} dest={{ kind: "index" }} className="text-sm">
          ← {t("forum.title")}
        </ForumLink>
        <h1 className="text-3xl">{t("forum.newThread")}</h1>
      </div>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("forum.thread.title")}>
          {(c) => (
            <Input
              {...c}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("forum.thread.title.placeholder")}
              maxLength={200}
              autoFocus
            />
          )}
        </Field>
        <Field label={t("forum.thread.body")}>
          {(c) => (
            <RichTextField
              id={c.id}
              value={body}
              onChange={setBody}
              placeholder={t("forum.thread.body.placeholder")}
              upload={upload}
              minHeightClass="min-h-48"
            />
          )}
        </Field>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div>
          <Button type="submit" loading={busy}>
            {t("forum.thread.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
