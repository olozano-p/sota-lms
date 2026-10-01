# ADR-021 · Content export and import as a versioned JSON directory

**Date** 2026-10-01 · **Status** accepted · extends ADR-012 (storage) and ADR-018 (cores)

## Decision

- **What travels.** `pnpm sota export` writes courses with their chapters, lessons, blocks, assignments,
  quizzes (questions and options) and, with `--cohorts`, each course's cohorts with their drip releases.
  `pnpm sota import` reads the same. People, enrollments, cohort members, submissions, quiz attempts,
  progress, teachers and the audit log never travel: a bundle is content, safe to hand to anyone.
- **Format: a directory, not an archive.** `sota-export.json` (format `sota-content`, `version: 1`,
  validated with zod before anything is written) next to `media/<id>-<name>`. A directory needs no
  dependency (Node has no zip and the repo has no archive library), every tool can pack it
  (`tar czf export.tgz dir`), and a human can diff the JSON in git. Rejected: a tar writer of our own
  (more code than the feature), adding `archiver`/`tar` (a runtime dependency for one command), a
  base64 blob inside the JSON (unreadable, a third larger).
- **No database ids in the bundle.** Rows are identified by slug (course also by `external_ref`,
  chapter and lesson by slug inside their parent, cohort by slug); blocks point at assignments and
  quizzes by a bundle-local `key` (`a1`, `q1`) and at files by a media id (`m1`); Markdown images
  (`/api/files/<id>`) become `sota-media:m1` and are rewritten to the new file's id on import.
  Assignments and quizzes have no slug, so they match by title and position among equal titles.
- **Import is idempotent and non-destructive.** A row equal to the bundle is not written; a differing
  one is updated; a missing one is created; rows the bundle does not mention are left alone (the
  import never deletes content). A lesson whose list of blocks differs gets the list replaced (blocks
  have no identity). A quiz that already has attempts keeps its questions (replacing them would delete
  learners' answers) and the import warns. A course found only by `external_ref` keeps its slug.
  `--draft` makes created courses and lessons drafts.
- **One transaction; `--dry-run` runs it and rolls it back**, so the report includes what the database
  would refuse; storage is not touched in a dry run. Everything is validated first: schema, unique
  slugs and keys, references inside the bundle, media paths confined to `media/`, size and sha256 of
  every file, and the deployment's upload limits and MIME allow-list (a bundle is not a way around
  them).
- **Media goes through `StorageProvider`**, which gains `getObject` for the export. Imported files get
  the key `courses/<course id>/[inline/]<sha256 prefix>-<name>`; the same bytes already in the course
  (an export imported into its own source) are reused, so a re-import stores nothing. Storage is not
  transactional: a failed import can leave unreferenced objects, which are harmless.
- **Authority and audit.** The import is a write core (`mutations/content-import-core.ts`) that takes a
  `ContentActor` minted only by `cliActor()`: like `create-admin` and `migrate`, the operator's shell and
  `DATABASE_URL` are the credential, and nothing reachable from a request calls it. It appends one
  `audit_log` row per course that changed (`content.import`, actor `cli:import`, counts and the first
  100 changes). The export is a read and writes nothing.

## Why

Moving a course between a staging and a production instance, or from one organisation's fork to
another, should not need SQL or a database copy that drags people along. Content as data also makes a
course reviewable and versionable.

## Consequences

- The bundle schema is public: changing its meaning needs `version: 2` and a reader for 1.
- A dropped lesson or chapter in the bundle is not removed from the target; delete it in the editor.
- Block references to an assignment of another course, a missing file or an empty embed are left out
  of the export with a warning.
- Export/import is not a backup (it omits people, progress and submissions): `docs/backup-restore.md`.
