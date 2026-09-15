import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CornerUpLeft, Pencil, Quote, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n";
import type { getThread } from "~/server/queries/forum";
import { deletePost, updatePost } from "~/server/mutations/forum";
import { Markdown } from "~/components/player/Markdown";
import { RichTextField } from "~/components/editor/RichTextField";
import type { UploadAdapter } from "~/components/editor/upload";
import { Alert } from "~/components/ui/alert";
import { Avatar } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { ReactionButtons } from "./ReactionButtons";
import { forumError } from "./errors";
import { When } from "./When";

type ThreadData = NonNullable<Awaited<ReturnType<typeof getThread>>>;
export type Post = ThreadData["posts"][number];

interface Props {
  post: Post;
  /** Cite this post in the reply composer. */
  onCite?: (post: Post) => void;
  upload: UploadAdapter;
}

/**
 * One message. The opening post has no card: a 2 px gold rule and the larger prose; replies are
 * rows under a hairline. Status (edited, deleted, role) is always a word, never colour alone.
 */
export function PostCard({ post, onCite, upload }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const update = useServerFn(updatePost);
  const remove = useServerFn(deletePost);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.md);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = post.author.name || t("forum.unknownAuthor");

  const save = async () => {
    if (!draft.trim()) return setError(t("forum.reply.empty"));
    setBusy(true);
    setError(null);
    try {
      await update({ data: { postId: post.id, bodyMd: draft } });
      setEditing(false);
      await router.invalidate();
    } catch (e) {
      setError(forumError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await remove({ data: { postId: post.id } });
      setConfirmDelete(false);
      await router.invalidate();
    } catch (e) {
      setError(forumError(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      id={`post-${post.id}`}
      className={cn(
        "flex flex-col gap-3 scroll-mt-24 target:bg-accent target:transition-colors",
        post.isOpening ? "border-l-2 border-primary pl-5" : "py-5",
      )}
      aria-label={post.isOpening ? t("forum.opening") : undefined}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Avatar name={name} size={post.isOpening ? "md" : "sm"} />
        <span className="font-medium">{name}</span>
        {post.author.role ? (
          <Badge variant="info">{t(`forum.role.${post.author.role}`)}</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          <When date={post.createdAt} />
          {post.editedAt ? <> · {t("forum.post.edited")}</> : null}
        </span>
        {post.replyTo ? (
          <a href={`#post-${post.replyTo.id}`} className="inline-flex items-center gap-1 text-xs">
            <CornerUpLeft className="size-3.5" aria-hidden="true" />
            {t("forum.post.inReplyTo", {
              name: post.replyTo.authorName || t("forum.unknownAuthor"),
            })}
          </a>
        ) : null}
      </header>

      {post.deleted ? (
        <p className="text-sm text-muted-foreground italic">{t("forum.post.deleted")}</p>
      ) : editing ? (
        <div className="flex flex-col gap-3">
          <RichTextField value={draft} onChange={setDraft} upload={upload} autoFocus />
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" loading={busy} onClick={save}>
              {t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(post.md);
                setEditing(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Markdown
          html={post.html}
          className={cn("prose", post.isOpening ? "" : "text-[0.95rem]")}
        />
      )}

      {!post.deleted && !editing ? (
        <footer className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <ReactionButtons
            key={`${post.likes}:${post.dislikes}:${post.myReaction ?? ""}`}
            postId={post.id}
            likes={post.likes}
            dislikes={post.dislikes}
            myReaction={post.myReaction}
            enabled={post.canReact}
          />
          {onCite ? (
            <Button size="sm" variant="ghost" onClick={() => onCite(post)}>
              <Quote aria-hidden="true" />
              {t("forum.post.cite")}
            </Button>
          ) : null}
          {post.canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t("forum.post.edit")}
            </Button>
          ) : null}
          {post.canDelete ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              {t("forum.post.delete")}
            </Button>
          ) : null}
          {error && !editing ? (
            <span className="text-xs text-destructive-foreground" role="alert">
              {error}
            </span>
          ) : null}
        </footer>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={t("forum.post.delete")}
        description={t("forum.post.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        loading={busy}
        onConfirm={del}
        onClose={() => setConfirmDelete(false)}
      />
    </article>
  );
}
