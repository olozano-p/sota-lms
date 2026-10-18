# Changelog

All notable changes to SOTA are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`examples/themes/twilight`**: a third example theme with tokens only (indigo and apricot palette,
  self-hosted Fraunces and Figtree, a wordmark logo, a few lines of CSS) and no slot.

### Changed

- The README shows English screenshots of a demo meditation school in the Twilight theme, the same
  lesson under all four themes, an access diagram, the stack, deployment in one block and measured
  build, size and start-up numbers.

## [1.1.0] - 2026-10-18

### Added

- **`pnpm sota import-progress <file.jsonl> [--dry-run]`** (ADR-023, `docs/progress-import.md`): lesson
  completions from another LMS in the `sota-progress/v1` JSON Lines format; learners found by `sub` or
  email, or created as the placeholders the service API creates (oidc mode); never downgrades a
  completion, skips unknown references, one transaction, audited as `progress.import`.
- **Course covers**: set from course settings, shown on the _My courses_ cards and the course page.
- **PDF preview**: a PDF file block shows the document inline below its download link.
- The service API's progress responses carry the course link and the next open lesson.
- **`HOST`**: the address the production server binds to; `127.0.0.1` when a proxy on the same host
  is the only way in (the rsync/pm2 deploy). Empty keeps every interface, as a container needs.

### Changed

- The placeholder merge at first sign-in (`adoptSubPlaceholder`) also moves lesson progress, keeping the
  completed row, then the earlier completion, when both people hold one.
- The default theme is rebuilt on paper, tint and the label style; the lesson sits inside the course
  frame with a collapsible syllabus; _My courses_ is a grid of cover cards; forum, assignment, quiz,
  cohort and sign-in screens follow the same look.
- Images are served as resized WebP copies (quality 90) that the browser keeps and revalidates, so
  every view still passes the access check but an unchanged image costs a 304.
- English and `Europe/Paris` are the shipped defaults (the default theme's `defaultLocale`, the
  `timeZone` in `lms.config.ts`). **Upgrading:** a deployment on the default theme that relied on
  Catalan sets `DEFAULT_LOCALE=ca`, and one that relied on `Europe/Madrid` sets its own `timeZone`.

### Fixed

- A theme with its own ink or paper derives card and tint from its palette instead of inheriting the
  default's.
- Concurrent OIDC sign-ins of the same subject are serialised.
- A repeated `error` parameter no longer crashes the landing page.
- The rsync deploy ships every file `scripts/serve.mjs` and the `sota` CLI load.
- The mock IdP container reaches the host dev server for webhook pushes.

### Security

- At OIDC sign-in an email adopts only a placeholder person, and only when the IdP marks it verified;
  before, whoever could set an address at the IdP became the person holding it.
- Course covers are served by the same filter that lists the course and accept only course images.
- Image copies are bounded: source size, pixel count, decoded format, one encode per copy.
- Dependencies past published advisories: nodemailer 10, TanStack Start and source-map-js.

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
- Schibsted Grotesk replaces Source Sans 3; the page is white with a gold accent.
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
