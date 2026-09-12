# Changelog

All notable changes to SOTA are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
