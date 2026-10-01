# ADR-014 · `enrollment` replaces `entitlement`

**Date** 2026-10-01 · **Status** accepted · Supersedes the model in ADR-004

## Decision

Access is stored as `enrollment(user_id, course_id, cohort_id?, source manual|claims|webhook,
external_id?, valid_from, valid_until?, status)`. A user may open a course if any enrollment is
`active` inside `valid_from..valid_until` and, when cohort-scoped, the cohort's drip releases the
lesson. `canSeeLesson()` stays the one pure access function and takes enrollments as data.

- Sync processes (`claims` at login, `webhook`/service API) never create, modify or delete `manual` rows.
- Synced rows are read-only in the admin UI and show their origin and `external_id`.
- SOTA never expands tiers or decides what a membership includes: `all_courses` scope and named
  `accessRules` (e.g. `delayed_after_course_end`) are removed; the external system sends per-course
  enrollments with the `valid_until` it wants.

## Why

Authority lives outside when a provider is configured; tier logic in `lms.config.ts` was business
logic of a deployment. One row per course/cohort is simpler to audit and to sync idempotently.

## Consequences

- A migration creates `enrollment`, copies `course` and `cohort` scoped `entitlement` rows
  (`external` → `webhook`, `admin` → `manual`), and drops `entitlement`. `all_courses` rows cannot be
  copied without a course list and are reported by the migration script. Dropping data is confirmed
  with the maintainer before the migration is generated.
- Drip stays as `cohort_release` (explicit dates) plus a generated rule (one chapter per week from
  `starts_at`) that writes those rows, so access never depends on a stored "unlocked" flag.
