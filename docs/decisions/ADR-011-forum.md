# ADR-011 · A forum per course and a general forum

**Date** 2026-09-15 · **Status** accepted · reverses the v1 non-goal in `docs/spec.md` §1

## Decision

SOTA gets discussion threads: one forum per course, switched on by its teachers
(`course.forum_enabled`), and one general forum outside any course, switched on in `lms.config.ts`
(`forum.general`). Threads (`forum_thread`), posts (`forum_post`) and reactions (`forum_reaction`)
are ordinary tables under the usual rules: every write is a mutation with an audit row, bodies are
Markdown edited with the rich-text editor (ADR-010), files go through `/api/files`.

- **Access follows the course.** `requireForumAccess()` (`src/server/access/forum.ts`) lets a
  person into a course forum when they teach the course or `decideCourse()` says the course is
  open to them right now; a student whose delayed access has not started cannot read it either.
  The general forum needs a session and the config switch. `canSeeLesson()` is untouched.
- **Moderators** are the course's teachers and admins; in the general forum, admins and anyone
  with the teacher role. They pin, lock, rename and delete threads and edit or delete any post.
- **Ordering is computed**: pinned threads first (latest pin on top), then the latest post,
  from an aggregate over `forum_post`. No `last_post_at` column to keep in step.
- **The opening post is a post** (the thread's earliest), so quoting, reactions and editing are
  one code path. Deleting a post is a soft delete that keeps the slot, so replies that cite it
  still read; the opening post goes with its thread (moderators only).
- **Reactions**: one row per person and post, `like` or `dislike`; the same value again removes
  it, the other replaces it, never on your own post. Counted, never cached.
- **Citing** stores `reply_to_post_id` and prefixes the reply with a Markdown blockquote of the
  cited post, so the link survives even when the quote is edited away.
- **Notifications** reuse the digest queue: a reply goes to everyone who wrote in the thread, a
  new thread to the course's teachers. No subscriptions, no per-kind preferences yet.
- **Images in posts** use their own presigned-PUT pair with a `forum/course/<id>/…` or
  `forum/general/…` key prefix; the files route reads the scope from the key.

## Why

The reference deployment asked for a place where students ask questions between lessons without
leaving the school, and for teachers to answer once for everyone. Building it on the existing
gates, queue and editor keeps it a feature rather than a second product.

## Consequences

- The course page gains a layout with _Syllabus · Forum_ tabs when the forum is on; the lesson
  player keeps its URL outside that frame. `forum` is a reserved lesson slug.
- `src/lib/forum.ts` carries the pure rules (reaction transitions, participants, ordering, file
  scopes) with tests; `tests/forum.test.ts` covers the gate matrix.
- Not included, deliberately: thread subscriptions or mute, mentions, full-text search of bodies
  (titles only), attachments other than images, posting cooldowns. Each is a small addition on
  top of this model when someone asks.
