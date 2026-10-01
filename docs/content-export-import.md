# Moving content: `sota export` and `sota import`

Courses travel as a directory of plain JSON and media files (ADR-021). Use it to copy a course from a
staging instance to production, to share one between deployments, or to keep a course in git. It is
**not a backup**: people, enrollments, cohort members, submissions, quiz attempts and progress are never
exported (see `docs/backup-restore.md`).

```bash
# in the container: docker compose exec app node scripts/sota.ts export /tmp/export --course intro
pnpm sota export ./export --course intro --course advanced      # named courses
pnpm sota export ./export --all --cohorts                       # everything, with cohorts and drip dates
pnpm sota import ./export --dry-run                             # what would happen; nothing is stored
pnpm sota import ./export                                       # do it
pnpm sota import ./export --draft                               # new courses and lessons start as drafts
```

`export` refuses to overwrite an existing export unless `--force`. Both commands need the usual
environment (`DATABASE_URL`, and `STORAGE_*` for the media). To ship a bundle, pack the directory:
`tar czf export.tgz export`, `tar xzf export.tgz` on the other side.

## What is in the directory

```
sota-export.json     format "sota-content", version 1, the courses and the media manifest
media/m1-cover.png   one file per referenced object: cover, audio and file blocks, inline images
```

Each course carries its slug, `external_ref`, texts (Markdown), language, status, chapters, lessons,
blocks (`text`, `video`, `audio`, `file`, `assignment`, `quiz`, `embed`), assignments, quizzes with their
questions and options and, with `--cohorts`, cohorts (slug, `external_ref`, dates, status) and their
releases. No database id appears: references are slugs, bundle-local keys (`a1`, `q1`) and media ids
(`m1`; inline images are `sota-media:m1` in the Markdown).

## What import does

- **Idempotent by slug.** A course is found by slug, else by `external_ref` (then its slug is kept);
  chapters and lessons by slug inside their parent; cohorts by slug (a slug owned by a cohort of another
  course is an error); assignments and quizzes by title. Equal rows are not written, different ones are
  updated, missing ones created. Importing the same bundle twice changes nothing and writes no audit row.
- **It never deletes.** Chapters, lessons, assignments or quizzes that are in the database but not in
  the bundle stay. A lesson whose blocks differ gets its block list replaced. A quiz that has attempts
  keeps its questions (a warning says so). A cohort's other releases stay.
- **Validated before writing**: schema and version, duplicate slugs or keys, references that point at
  nothing, media paths outside `media/`, every file's size and sha256, and the deployment's
  `lms.config.ts` upload limits and allowed types. Problems are listed together.
- **One transaction.** Any error rolls the whole import back. `--dry-run` runs the same transaction and
  rolls it back, so the report is what a real run would do. Files are written to storage only in a real
  run, under `courses/<id>/...` named by content hash; identical bytes already in the course are reused.
- **Audit.** One `content.import` row per course that changed, actor `cli:import`, with counts and the
  first 100 changes (`docs/audit-log.md`).

The operator who can run the command and reach `DATABASE_URL` is the authority; there is no web
endpoint for import.
