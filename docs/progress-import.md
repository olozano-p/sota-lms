# Bringing progress along: `sota import-progress`

A school moving to SOTA from another LMS can bring its learners' **lesson completions** with it
(ADR-023). Import the courses first (`pnpm sota import`, `docs/content-export-import.md`, or by hand
in the editor), then the progress. Nothing else travels this way: no enrollments, quiz answers,
submissions, playback positions or forum posts.

```bash
# in the container: docker compose exec app node scripts/sota.ts import-progress /tmp/progress.jsonl
pnpm sota import-progress ./progress.jsonl --dry-run   # what would happen; nothing is stored
pnpm sota import-progress ./progress.jsonl             # do it
```

It needs the usual environment (`DATABASE_URL`, and `AUTH_MODE` / `OIDC_ISSUER`, which decide how
learners are found). The operator who can run the command and reach `DATABASE_URL` is the
authority; there is no web endpoint for it.

## The file: `sota-progress/v1`

JSON Lines: one object per line, one learner and one course per object; blank lines are ignored. A
learner with progress in three courses has three lines.

```json
{
  "format": "sota-progress",
  "version": 1,
  "sub": "idp-user-1",
  "email": "ana@example.org",
  "name": "Ana Puig",
  "course": "intro",
  "lessons": [
    { "chapter": "first-steps", "lesson": "welcome", "completed_at": "2025-03-01T10:00:00Z" },
    { "chapter": "first-steps", "lesson": "posture", "completed_at": "2025-03-08T09:30:00+01:00" }
  ]
}
```

| Field                    | Meaning                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `format`, `version`      | Always `"sota-progress"` and `1`.                                                                                              |
| `sub`                    | The learner's OIDC subject (`person.external_sub`): what the IdP will send as `sub` when they sign in. The key in `oidc` mode. |
| `email`                  | The learner's address. Optional when `sub` is given; at least one of the two is required.                                      |
| `name`                   | Optional; labels a new placeholder. Never overwrites an existing person's name.                                                |
| `course`                 | Course slug or the course's `external_ref`.                                                                                    |
| `lessons[].chapter`      | Chapter slug inside that course.                                                                                               |
| `lessons[].lesson`       | Lesson slug inside that chapter.                                                                                               |
| `lessons[].completed_at` | ISO 8601 instant with an offset (`Z` or `+01:00`).                                                                             |

Objects are strict: an unknown key is an error. Every line is validated before anything is written,
and the problems are listed together with their line numbers.

## Who a line is about

1. **By `sub`**: the person who signed in with that `sub` under the configured `OIDC_ISSUER`, else
   the placeholder that carries the `sub` and no issuer (created by the service API, the enrollment
   pull or an earlier progress import).
2. **By `email`**: anyone with that address (case-insensitive). If they have no `sub` yet and the line
   has one, they take it, as the service API and the pull do. If they already have a different `sub`,
   the line is skipped (`the email belongs to a person with another sub`).
3. **Otherwise**, in `oidc` mode, a **placeholder** student is created exactly as the service API
   creates one: `external_sub` = the line's `sub`, `external_iss` empty, no account, no session. With
   an `email` its address is that email; without one it is a made-up `u-<hash>@placeholder.invalid`
   that never receives mail. In `local` mode nobody is created: the line is skipped (create the
   accounts first, by invitation or sign-up).

A placeholder is adopted at the learner's **first sign-in**: when the IdP releases the same email,
better-auth links the sign-in to it; when it releases another one, `adoptSubPlaceholder` merges the
placeholder into the new person by `sub`, moving its enrollments and its progress. So the producer
must send, as `sub`, exactly the subject the IdP will put in the ID token. A line whose lessons are
all unknown creates nobody.

## What import does

- **Completions only, never a downgrade.** A lesson with no row gets a `completed` row with
  `completed_at`. A lesson the learner has started becomes `completed` with the file's
  `completed_at` (their playback position stays). A lesson already completed is **never touched**:
  not its status and not its date, even if the file has an earlier one. A lesson listed twice for the
  same learner keeps the earlier `completed_at`.
- **Idempotent.** Running the same file again changes nothing and writes no audit row.
- **Unknown references are skipped, not errors.** A course, chapter or lesson that does not exist
  is counted as skipped and listed in the summary with its line, so a partial migration still loads
  what it can.
- **No enrollments.** Access stays where it was: the enrollment source (pull, webhook, service API,
  claims) or an admin. Imported progress on a course the learner cannot open is kept and shows when
  access arrives.
- **One transaction.** Any error rolls the whole file back. `--dry-run` runs the same transaction and
  rolls it back, so the summary is what a real run would do.
- **Audit.** One `progress.import` row per line that wrote something (entity `person`, actor
  `cli:import`), with the counts, whether the person was created or took the `sub`, and the first 100
  lessons written (`docs/audit-log.md`).

## Summary

```
read 3 record(s)
people: 1 found, 1 placeholder(s) created
lessons: 4 created, 1 marked completed, 2 already completed, 2 skipped
  skipped line 2 intro/first-steps/old-lesson: unknown chapter or lesson
  skipped line 3 retired-course: unknown course
import complete
```

The first 200 skipped references are printed; the rest are counted.
