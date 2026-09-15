import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Lock, LockOpen, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { useI18n } from "~/i18n";
import type { getThread } from "~/server/queries/forum";
import { deleteThread, replyToThread, updateThread } from "~/server/mutations/forum";
import { RichTextField } from "~/components/editor/RichTextField";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Eyebrow } from "~/components/ui/eyebrow";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { ForumLink, forumPath } from "./links";
import { PostCard, type Post } from "./PostCard";
import { When } from "./When";
import { forumError } from "./errors";
import { useForumUpload } from "./upload";

type ThreadData = NonNullable<Awaited<ReturnType<typeof getThread>>>;

/** Turns a post into a quote for the composer: `> **Name:**` then its lines. */
function quoteOf(post: Post, fallbackName: string): string {
  const name = post.author.name || fallbackName;
  const lines = post.md.trim().split("\n");
  return [`> **${name}:**`, ">", ...lines.map((l) => (l ? `> ${l}` : ">")), "", ""].join("\n");
}

export function ThreadView({ data, courseSlug }: { data: ThreadData; courseSlug: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const navigate = useNavigate();
  const upload = useForumUpload(courseSlug);
  const reply = useServerFn(replyToThread);
  const patchThread = useServerFn(updateThread);
  const removeThread = useServerFn(deleteThread);
  const { thread, posts, moderator, canReply } = data;

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Post | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [composerKey, setComposerKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const cite = (post: Post) => {
    setReplyTo(post);
    setBody(
      (b) => (b.trim() ? `${b.trimEnd()}\n\n` : "") + quoteOf(post, t("forum.unknownAuthor")),
    );
    setFocusToken((n) => n + 1);
  };

  const send = async () => {
    if (!body.trim()) return setError(t("forum.reply.empty"));
    setSending(true);
    setError(null);
    try {
      const { id } = await reply({
        data: { threadId: thread.id, bodyMd: body, replyToPostId: replyTo?.id ?? null },
      });
      setBody("");
      setReplyTo(null);
      setComposerKey((k) => k + 1);
      await router.invalidate();
      await navigate({
        to: forumPath(courseSlug, { kind: "thread", threadId: thread.id }),
        hash: `post-${id}`,
      });
    } catch (e) {
      setError(forumError(t, e));
    } finally {
      setSending(false);
    }
  };

  const patch = async (key: string, p: Parameters<typeof updateThread>[0]["data"]["patch"]) => {
    setBusy(key);
    try {
      await patchThread({ data: { threadId: thread.id, patch: p } });
      await router.invalidate();
    } catch (e) {
      setError(forumError(t, e));
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    setBusy("delete");
    try {
      await removeThread({ data: { threadId: thread.id } });
      await navigate({ to: forumPath(courseSlug, { kind: "index" }) });
    } catch (e) {
      setError(forumError(t, e));
      setBusy(null);
    }
  };

  const opening = posts.find((p) => p.isOpening);
  const replies = posts.filter((p) => !p.isOpening);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <ForumLink courseSlug={courseSlug} dest={{ kind: "index" }} className="text-sm">
          ← {t("forum.title")}
        </ForumLink>
        <div className="flex flex-wrap items-center gap-2">
          {thread.pinned ? (
            <Badge>
              <Pin aria-hidden="true" /> {t("forum.pinned")}
            </Badge>
          ) : null}
          {thread.locked ? (
            <Badge variant="warning">
              <Lock aria-hidden="true" /> {t("forum.locked")}
            </Badge>
          ) : null}
        </div>
        {renaming ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (title.trim().length >= 3 && title.trim() !== thread.title)
                await patch("title", { title: title.trim() });
              setRenaming(false);
            }}
          >
            <Field label={t("forum.thread.title")} className="min-w-64 flex-1">
              {(c) => (
                <Input
                  {...c}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  autoFocus
                />
              )}
            </Field>
            <Button type="submit" variant="outline" loading={busy === "title"}>
              {t("common.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
          </form>
        ) : (
          <h1 className="text-3xl leading-tight sm:text-4xl">{thread.title}</h1>
        )}
        <p className="text-sm text-muted-foreground">
          {t("forum.started", { name: thread.author.name || t("forum.unknownAuthor") })}{" "}
          <When date={thread.createdAt} />
        </p>
        {thread.canRename || moderator ? (
          <div className="flex flex-wrap gap-1">
            {thread.canRename && !renaming ? (
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
                <Pencil aria-hidden="true" />
                {t("forum.thread.rename")}
              </Button>
            ) : null}
            {moderator ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === "pin"}
                  onClick={() => patch("pin", { pinned: !thread.pinned })}
                >
                  {thread.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                  {thread.pinned ? t("forum.thread.unpin") : t("forum.thread.pin")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === "lock"}
                  onClick={() => patch("lock", { locked: !thread.locked })}
                >
                  {thread.locked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
                  {thread.locked ? t("forum.thread.unlock") : t("forum.thread.lock")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" />
                  {t("forum.thread.delete")}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      {opening ? (
        <PostCard post={opening} onCite={canReply ? cite : undefined} upload={upload} />
      ) : null}

      <section className="flex flex-col">
        <Eyebrow className="border-b pb-2">
          {replies.length === 1
            ? t("forum.replies.one")
            : t("forum.replies", { n: replies.length })}
        </Eyebrow>
        <div className="divide-y">
          {replies.map((p) => (
            <PostCard key={p.id} post={p} onCite={canReply ? cite : undefined} upload={upload} />
          ))}
        </div>
      </section>

      {canReply ? (
        <section className="flex flex-col gap-3 border-t pt-6" aria-labelledby="reply-heading">
          <h2 id="reply-heading" className="text-lg">
            {t("forum.reply.title")}
          </h2>
          {replyTo ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {t("forum.reply.replyingTo", {
                  name: replyTo.author.name || t("forum.unknownAuthor"),
                })}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("forum.reply.cancelCite")}
                onClick={() => setReplyTo(null)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : null}
          <RichTextField
            key={composerKey}
            value={body}
            onChange={setBody}
            placeholder={t("forum.reply.placeholder")}
            upload={upload}
            focusToken={focusToken}
            minHeightClass="min-h-32"
          />
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div>
            <Button onClick={send} loading={sending}>
              {t("forum.reply.send")}
            </Button>
          </div>
        </section>
      ) : (
        <Alert variant="info">{t("forum.thread.lockedNotice")}</Alert>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("forum.thread.delete")}
        description={t("forum.thread.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        loading={busy === "delete"}
        onConfirm={del}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
