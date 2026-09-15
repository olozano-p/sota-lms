import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** The same forum pages exist inside a course and at the root; these pick the right route. */
export type ForumTarget =
  | { kind: "index"; page?: number; q?: string }
  | { kind: "new" }
  | { kind: "thread"; threadId: string; hash?: string };

interface Props {
  courseSlug: string | null;
  dest: ForumTarget;
  children: ReactNode;
  className?: string;
}

export function ForumLink({ courseSlug, dest, children, className }: Props) {
  const target = dest;
  const rest = { className };
  const search =
    target.kind === "index"
      ? { page: target.page && target.page > 1 ? target.page : undefined, q: target.q || undefined }
      : undefined;
  if (courseSlug) {
    if (target.kind === "index")
      return (
        <Link
          {...rest}
          to="/courses/$courseSlug/forum"
          params={{ courseSlug }}
          search={search}
          activeOptions={{ exact: true, includeSearch: false }}
        >
          {children}
        </Link>
      );
    if (target.kind === "new")
      return (
        <Link {...rest} to="/courses/$courseSlug/forum/new" params={{ courseSlug }}>
          {children}
        </Link>
      );
    return (
      <Link
        {...rest}
        to="/courses/$courseSlug/forum/$threadId"
        params={{ courseSlug, threadId: target.threadId }}
        hash={target.hash}
      >
        {children}
      </Link>
    );
  }
  if (target.kind === "index")
    return (
      <Link
        {...rest}
        to="/forum"
        search={search}
        activeOptions={{ exact: true, includeSearch: false }}
      >
        {children}
      </Link>
    );
  if (target.kind === "new")
    return (
      <Link {...rest} to="/forum/new">
        {children}
      </Link>
    );
  return (
    <Link {...rest} to="/forum/$threadId" params={{ threadId: target.threadId }} hash={target.hash}>
      {children}
    </Link>
  );
}

/** Path string for `navigate({ to })` after a mutation. */
export function forumPath(courseSlug: string | null, target: ForumTarget): string {
  const base = courseSlug ? `/courses/${courseSlug}/forum` : "/forum";
  if (target.kind === "index") return base;
  if (target.kind === "new") return `${base}/new`;
  return `${base}/${target.threadId}${target.hash ? `#${target.hash}` : ""}`;
}
