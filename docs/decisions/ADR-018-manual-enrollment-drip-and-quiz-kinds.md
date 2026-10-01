# ADR-018 · Manual enrollment by list and cohort, placeholder people, generated drip, quiz kinds

**Date** 2026-10-01 · **Status** accepted · implements ADR-014 and ADR-016

## Decision

- **Who enrolls.** Admins and the course's teachers (`requireCourseTeacher`) may enroll one address
  or a pasted list (at most 500) in a course, optionally in one of its cohorts, and may enroll all
  students of a cohort in a course (`mutations/enrollments.ts`). The rows are `source = 'manual'`,
  idempotent per person, course and cohort, and end with one `audit_log` row per call listing the
  outcome per address. A teacher needs to teach both the cohort's course and the target course.
- **Unknown addresses.** In `local` mode a new student account is created through the ordinary
  invitation (7-day link, mail queued and flushed after commit). In `oidc` mode a placeholder
  `person` is inserted with the address, `student` role, and null `external_sub`/`external_iss`; the
  OIDC sign-in and the webhook already adopt a person by email and fill the sub, so the enrollment
  that waited for them applies at once. A placeholder has no credential and no session, so it is
  inert until the IdP vouches for the address. Invitations by teachers are always `student`.
- **Drip rule.** "N chapters every D days from a start date" (`lib/drip.ts`, `applyDripRule`)
  expands to chapter-level `cohort_release` rows at local midnight of `lms.config.ts → timeZone`,
  replacing the cohort's earlier chapter releases and keeping lesson-level ones. The rule is not
  stored: access still reads only the dates, so there is no "unlocked" flag and the rows stay editable.
- **Quiz kinds** are `form | self_check` (migration 0004 renames `quiz` to `self_check`). A form keeps
  no score; a self-check shows choice feedback. Neither grades anyone for the teacher nor gates
  progress; `pass_threshold` remains as an informational percentage.
- **Core modules.** Server-function files export nothing server-only besides the functions; the
  writes live in `*-core.ts` siblings (`enrollments-core`, `people-core`, `cohorts-core`). A plain
  export with a database or Node import was pulled into the client bundle and crashed `/admin`
  with "Buffer is not defined".
- **Compose.** `compose.yml` at the repository root is the image-based production stack that
  `docs/deploying.md` uses; the development stack is `compose.dev.yml`.

## Consequences

- The auth limiter of better-auth keys on `x-sota-client-ip`, stamped by `withClientIp` from the same
  trusted address the request middleware uses; before, every client shared one bucket.
- A teacher can cause invitation mail to be sent to addresses they paste; the 500 cap per call and the
  audit row are the only brakes; there is no per-teacher rate limit.
