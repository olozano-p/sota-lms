# Changelog

All notable changes to SOTA are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-01

First release. SOTA is a self-hostable course platform with two ways to sign in (a local account
store or your OIDC provider), enrollments from a source of your choice, a theme directory, a service
API, and a container image published on every version tag.

### Added

- **Two authentication modes** (`AUTH_MODE=local|oidc`, ADR-013, ADR-016, ADR-017): email + password,
  magic link and admin invitations on better-auth, or a generic OIDC client with roles and
  enrollments from claims; break-glass administrator; `pnpm sota create-admin`.
- **Enrollment model** (ADR-014, ADR-018): one `enrollment` row per person and course (optionally
  cohort) with a validity window; sources `manual`, `claims` and `webhook`; manual enrollment by pasted
  list or by cohort; placeholder people adopted at first sign-in; the "N chapters every D days" drip rule.
- **Service API** `/api/v1` (ADR-020, `docs/integration.md`): per-enrollment `PUT`/`DELETE`, progress and
  course reads, health, an OpenAPI 3.1 document generated from the route schemas; bearer token plus
  optional HMAC signature over method, path, timestamp and body.
- **Theme directory** (ADR-019, `docs/theming.md`): `theme.json`, `custom.css`, message overrides, mail
  layouts, assets and seven compiled slots; two example themes; `pnpm sota validate-theme`.
- **`pnpm sota export` / `import`** (ADR-021, `docs/content-export-import.md`): courses, chapters,
  lessons, blocks, assignments, quizzes and optionally cohorts with drip releases as versioned JSON plus
  media in a plain directory; import is idempotent by slug, validated first, transactional, supports
  `--dry-run`, remaps ids, writes audit rows and stores media through the `StorageProvider`.
- **Structured logs and a real health check** (`docs/observability.md`): one JSON line per log event,
  `LOG_LEVEL`, a request log with id, method, path, status and duration and no secrets, tokens or
  addresses; `/api/health` reports the database round trip and the version and answers 503 when the
  database does not.
- **Audit trail for every enrollment write** (`docs/audit-log.md`): complete-set sync (push and pull),
  claims, sign-in, manual, bulk, cohort, service API and placeholder merge, with per-row before/after
  (capped for bulk).
- **Backup and restore guide** (`docs/backup-restore.md`), validated by a dump/restore drill, and a
  release workflow (`.github/workflows/release.yml`) that publishes `ghcr.io/<owner>/sota` on `vX.Y.Z`.
- Forums (ADR-011), the rich-text editor over Markdown (ADR-010), course, cohort and lesson authoring,
  assignments, quizzes and forms, notifications by mail, three locales, the lesson player with progress
  and media resume, Playwright suites, and the Docker/Compose deployment (`docs/deploying.md`).

### Changed

- `enrollment` replaces `entitlement` (ADR-014): the pull/push payload is `enrollments/v1`;
  `all_courses`, `accessRules` and `delayed_after_course_end` are gone. Breaking for sources still
  sending `entitlements/v1`.
- File storage sits behind a `StorageProvider` interface with a local filesystem driver (the default)
  and an S3 driver; MinIO is gone from Compose, CI and the deploy reference (ADR-012).
- One signing secret, `WEBHOOK_HMAC_SECRET`, signs both push channels; `ENTITLEMENTS_WEBHOOK_SECRET` is a
  deprecated alias (ADR-020).
- Brand, colours and default language moved from `lms.config.ts` to the theme directory (ADR-019).
- Schibsted Grotesk replaces Source Sans 3; the page is white with a gold accent (ADR-009).
- A sync without `valid_from` keeps an existing enrollment's start instead of resetting it each time.
- `docker compose` for production is `compose.yml`; the development stack is `compose.dev.yml`.

### Security

- Rate limits cover better-auth's credential, mail and recovery endpoints (including
  `verify-password`), the legacy webhook and server functions; account mail is throttled per
  address (five of a kind and twelve in all per hour, whoever asks), and a refused re-invite leaves the
  pending link working.
- Assignment and quiz blocks may only reference their own course, and audio/file blocks only keys
  under the course's storage prefix; the container lookup for assignments and quizzes is scoped to
  the course.
- Submission files are served to their author, the teachers of that course and admins only.
- The production server answers 400 to malformed URLs and Host headers instead of exiting, and
  forwards every `Set-Cookie` header instead of the last one.
- The rate limiter honours `X-Forwarded-For` / `X-Real-IP` only behind `TRUST_PROXY=true`, takes the
  hop the proxy appended, and keys better-auth's own limiter on that address.
- The session cookie is always host-only; `COOKIE_DOMAIN` widens only the locale cookie.
- A Content-Security-Policy with a per-request nonce, `nosniff`, referrer and permissions policies, HSTS
  on HTTPS.
- The Docker image runs as `node`; CI runs with a read-only token and runs `pnpm audit`; `nodemailer`
  7 → 9.1 (two high advisories in 7.x).
