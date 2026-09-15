/** Pure forum rules: small enough to test exhaustively, shared by mutations and views. */

export type Reaction = "like" | "dislike";

/** Pressing the same reaction again removes it; the other one replaces it. */
export function nextReaction(
  current: Reaction | null,
  requested: Reaction | null,
): Reaction | null {
  if (requested === null) return null;
  return current === requested ? null : requested;
}

/** Distinct people to notify: everyone who wrote in the thread, minus the actor and gaps. */
export function participants(authorIds: (string | null)[], actorId: string): string[] {
  const out: string[] = [];
  for (const id of authorIds) {
    if (!id || id === actorId || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export interface ThreadOrderKeys {
  pinnedAt: Date | null;
  lastActivityAt: Date;
}

/** Pinned threads first (most recently pinned on top), then the latest activity. */
export function compareThreads(a: ThreadOrderKeys, b: ThreadOrderKeys): number {
  if (a.pinnedAt && !b.pinnedAt) return -1;
  if (!a.pinnedAt && b.pinnedAt) return 1;
  if (a.pinnedAt && b.pinnedAt && a.pinnedAt.getTime() !== b.pinnedAt.getTime())
    return b.pinnedAt.getTime() - a.pinnedAt.getTime();
  return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
}

/** Where an uploaded forum image lives tells us who may read it. */
export type ForumFileScope = { kind: "course"; courseId: string } | { kind: "general" };

export function forumScopeFromFileKey(key: string): ForumFileScope | null {
  const course = key.match(/^forum\/course\/([0-9a-f-]{36})\//);
  if (course) return { kind: "course", courseId: course[1]! };
  if (key.startsWith("forum/general/")) return { kind: "general" };
  return null;
}

export function forumFileKey(scope: ForumFileScope, unique: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").slice(-120);
  return scope.kind === "course"
    ? `forum/course/${scope.courseId}/${unique}-${safe}`
    : `forum/general/${unique}-${safe}`;
}
