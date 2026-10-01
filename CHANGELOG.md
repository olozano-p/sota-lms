# Changelog

All notable changes to SOTA are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- `enrollment` replaces `entitlement` (ADR-014): one row per person and course (optionally cohort)
  with `valid_from`/`valid_until` and a status. The pull/push payload is now `enrollments/v1`;
  `all_courses`, `accessRules` and `delayed_after_course_end` are gone, and admin grants are
  `manual` enrollments the sync never touches. Breaking for sources still sending
  `entitlements/v1`.
- File storage sits behind a `StorageProvider` interface with a local filesystem driver (the
  default: files under `STORAGE_DIR`, signed URLs honoured by `/api/storage/$token`) and the
  S3 driver (`STORAGE_DRIVER=s3`). MinIO is gone from docker compose, CI and the deploy
  reference; existing S3 deployments set `STORAGE_DRIVER=s3` (ADR-012).

### Added

- Forums: a per-course forum teachers enable in settings and a general forum (`forum.general` in
  `lms.config.ts`). Threads pinned-first then by latest reply, replies with author, date and
  like/dislike, "cite" quoting, moderation (pin, lock, rename, delete) by course teachers and
  admins, digest mail to thread participants and teachers (ADR-011).
- Rich-text editor over Markdown (Tiptap) for lesson text, course descriptions, assignment
  instructions, quiz intros and forum posts: headings, bold, italic, code, quotes, lists, links,
  image upload, and YouTube/Vimeo players from a pasted link (ADR-010).

- Project skeleton: TanStack Start app, Postgres schema, docker compose with a mock OIDC provider,
  design system, i18n scaffolding, CI.
- OIDC relying party (code + PKCE, own 12 h / 2 h session, IdP end-session on logout).
- `entitlements/v1` contract: pull with 15-minute TTL, HMAC-signed idempotent webhook, admin grants.
- `canSeeLesson()` access resolution with an exhaustive test matrix.
- Admin area: people, entitlements with local grants, webhook log, audit log.
- Learner core: course catalogue with computed progress and a single "continue" target, syllabus
  with lock states generated from the rule type, lesson player with text, video (Vimeo), audio,
  file and embed blocks, keyboard navigation, per-lesson progress with media resume, signed file
  downloads, cohort page with the release schedule.
- Authoring: `/teach` with course creation (admins) and teacher assignment, structure editor with
  drag-sort for chapters, lessons and blocks, autosave on blur, publish toggles, Markdown preview,
  presigned uploads with configurable limits, Vimeo URL resolution. Every write is audited.
- Assignments: text and/or file submissions with resubmission and history, teacher review with
  feedback (reviewed / returned), submission list with status filter.
- Quizzes and forms: builder with four question types, attempts with auto-grading of choice
  questions, optional pass mark, answers revealed after submission, results with per-option counts.
- Cohorts: teacher editor with members (manual by email or automatic from `cohort` entitlements)
  and a release schedule per chapter or lesson; member page with the calendar.
- Notifications over SMTP (console transport in dev): submission received → teachers, feedback
  returned → student (immediate), chapter released → cohort; daily digest at a configured hour;
  per-person opt-out column; `scripts/notify.ts` tick run by the production server or cron.
- Playwright smoke suite: SSO redirect and sign-out, lesson flow with progress and drip lock,
  authoring with upload, assignment submission and review, quiz attempt and results.
- Hardening: Content-Security-Policy with a per-request nonce (`frame-src` built from the enabled
  video providers and the embed allowlist), `nosniff`, referrer and permissions policies, HSTS on
  HTTPS, in-process rate limiting on `/auth/*` and `/api/*`.
- Deployment: production compose file, nginx sample, rsync + pm2 alternative, `docs/deploy.md`.

### Changed

- Schibsted Grotesk replaces Source Sans 3 as the interface face; the page is white with a gold
  accent and an ochre link colour; warning moves to rust (ADR-009).

### Security

- Assignment and quiz blocks may only reference their own course, and audio/file blocks only keys
  under the course's storage prefix; the container lookup for assignments and quizzes is scoped to
  the course. Before, a teacher of one course could expose another course's assignments, quiz
  answers and files to their students.
- Submission files are served to their author, the teachers of that course and admins only, not to
  every teacher.
- The production server answers 400 to malformed URLs and Host headers instead of exiting, and
  forwards every `Set-Cookie` header instead of the last one.
- The rate limiter honours `X-Forwarded-For` / `X-Real-IP` only behind `TRUST_PROXY=true`, takes
  the hop the proxy appended, and otherwise keys on the socket peer.
- The session cookie is always host-only; `COOKIE_DOMAIN` widens only the locale cookie.
- The Docker image runs as `node`; CI runs with a read-only token and no longer ignores `pnpm audit`.
- `nodemailer` 7 → 9.1 (two high advisories in 7.x).
