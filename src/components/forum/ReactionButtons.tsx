import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useI18n } from "~/i18n";
import type { ForumReaction } from "~/db/schema";
import { reactToPost } from "~/server/mutations/forum";
import { nextReaction } from "~/lib/forum";
import { cn } from "~/lib/cn";

interface Props {
  postId: string;
  likes: number;
  dislikes: number;
  myReaction: ForumReaction | null;
  /** False on your own post and on deleted posts. */
  enabled: boolean;
}

/** Like / dislike with counts; optimistic, then reconciled with the server's numbers. */
export function ReactionButtons({ postId, likes, dislikes, myReaction, enabled }: Props) {
  const { t } = useI18n();
  const react = useServerFn(reactToPost);
  const [state, setState] = useState({ likes, dislikes, mine: myReaction });
  const [busy, setBusy] = useState(false);

  const press = async (value: ForumReaction) => {
    if (!enabled || busy) return;
    const next = nextReaction(state.mine, value);
    const delta = (v: ForumReaction) => (next === v ? 1 : 0) - (state.mine === v ? 1 : 0);
    setState({
      likes: state.likes + delta("like"),
      dislikes: state.dislikes + delta("dislike"),
      mine: next,
    });
    setBusy(true);
    try {
      const r = await react({ data: { postId, value } });
      setState({ likes: r.likes, dislikes: r.dislikes, mine: r.myReaction });
    } catch {
      setState({ likes, dislikes, mine: myReaction });
    } finally {
      setBusy(false);
    }
  };

  const btn = (value: ForumReaction, count: number, label: string, Icon: typeof ThumbsUp) => (
    <button
      type="button"
      aria-pressed={state.mine === value}
      aria-label={label}
      title={enabled ? label : t("forum.post.ownReaction")}
      disabled={!enabled}
      onClick={() => press(value)}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded px-2 text-[0.6875rem] text-muted-foreground tabular-nums",
        "transition-colors duration-[120ms] ease-(--ease) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        enabled ? "hover:bg-accent hover:text-foreground" : "cursor-default",
        state.mine === value && "bg-accent text-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {count}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5">
      {btn("like", state.likes, t("forum.post.like"), ThumbsUp)}
      {btn("dislike", state.dislikes, t("forum.post.dislike"), ThumbsDown)}
    </div>
  );
}
