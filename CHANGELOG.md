# Changelog

All notable changes to Lodrö are documented here. The format follows
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
- Playwright smoke suite: SSO redirect and sign-out, lesson flow with progress and drip lock,
  authoring with upload.
