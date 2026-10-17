# ADR-023 · Progress import from another LMS as JSON Lines

**Date** 2026-10-17 · **Status** accepted · extends ADR-021 (content import), ADR-016 (placeholders) and
ADR-020 (service API placeholders)

## Decision

- **What travels.** `pnpm sota import-progress <file.jsonl> [--dry-run]` writes lesson completions
  into `lesson_progress`. Only completions: no enrollments, no playback positions, no quiz attempts or
  submissions. Access keeps coming from the enrollment source or an admin (ADR-014); a progress file is
  not a way to grant it.
- **Format `sota-progress/v1`: JSON Lines**, one learner and one course per line
  (`{format, version, sub?, email?, name?, course, lessons: [{chapter, lesson, completed_at}]}`),
  validated with zod strict objects, every line before anything is written. Lines rather than one
  document because the producer is usually a script walking another system's learners: it can stream
  them, and an error points at a line. References are the course's slug or `external_ref` and the
  chapter and lesson slugs, as in the content bundle; never database ids.
- **Learners are found the way the other non-session writers find them**: by `sub` under the
  configured issuer, else the sub-keyed placeholder (no issuer, no account), else by email (taking the
  `sub` when the person has none, skipping the line when they hold another), else in `oidc` mode a new
  placeholder created by `insertPlaceholderPerson`, the helper the service API now shares, so that
  account linking (same email) or `adoptSubPlaceholder` (same `sub`) adopts it at the first sign-in.
  In `local` mode the import creates nobody.
- **Never a downgrade.** A missing row is inserted as completed; a started row becomes completed
  with the file's date; a completed row is not written at all, not even to an earlier date. The
  insert is one upsert whose update is conditioned on the stored row not being completed, so a learner
  playing a lesson while the import runs cannot lose a completion either way.
- **Unknown references are skips.** A course, chapter or lesson that does not exist is counted and
  listed, not an error: a migration loads what matches and reports the rest. Schema errors still
  refuse the whole file.
- **The placeholder merge moves progress.** `adoptSubPlaceholder` now moves `lesson_progress` with
  the enrollments. Of two rows for one lesson the completed one survives, of two completed ones the
  earlier completion; otherwise the signed-in person's row stays.
- **Authority and audit as in ADR-021**: a write core (`mutations/progress-import-core.ts`) taking the
  `cliActor()` of the content import; one transaction; `--dry-run` rolls it back; one
  `progress.import` audit row per line that wrote something, actor `cli:import`, with counts and the
  first 100 lessons.

## Why

A school changing LMS wants its learners to find their place. Completions are the part that carries
meaning across systems; positions inside a video or answers to another platform's quizzes do not map.
Reusing the placeholder machinery means the learner's first sign-in needs nothing new.

## Consequences

- The producer must send the `sub` the IdP will put in the ID token (in a better-auth-backed IdP,
  the user id). A wrong `sub` with a right email still lands on the person once they sign in with that
  email; a wrong `sub` without an email leaves an orphan placeholder.
- An imported completion can never be corrected downwards by a re-import; the learner unmarks it in
  the lesson.
- The file format is public: changing its meaning needs `version: 2` and a reader for 1.
