# SOTA — Build Spec (v1)

> **Decisions log (2026-09-11).** The open questions of §11 were settled as follows; each has an
> ADR in `docs/decisions/`: name **SOTA** (repo `olozano-p/sota-lms`) · licence
> **MIT** (ADR-006) · content **Markdown** (ADR-007) · hand-written UI primitives instead of
> shadcn (ADR-008) · Postgres 16 + PGlite in tests (ADR-002) · admin-grant write-back deferred to
> v1.1 · a cohort belongs to one course · `pass_threshold` supported, nullable · audio in object
> storage · prod storage: a directory on the VPS or an external bucket, both in `docs/deploy.md` (ADR-012).
> ADR file names follow the house style (`ADR-00n-topic.md`) rather than the paths in §9.

Name: **SOTA** (after Pali _sotāpanna_, "the one who has entered the stream"; repo `sota`). A lean, self-hostable, open-source course platform. Inspired by Frappe LMS's core model (Course → Chapter → Lesson, Batch → Cohort, Quiz, Assignment) but stripped to the essentials and built as a **relying party**: identity and enrollments come from an external OIDC identity provider; the LMS never owns accounts or payments.

**First production deployment and reference implementation: a small foundation's members' school**, with the foundation's own members' site as the IdP. Every feature in this spec is driven by that deployment's needs, but nothing in the codebase may be specific to it — all of its particulars live in configuration and in Appendix A.

This document is written to be handed to a coding agent. Sections marked **DECISION** are settled. Sections marked **OPEN** need Oscar's answer before implementation.

---

## 0. Open-source principles — **DECISION**

These are constraints on _how_ the project is built, not features:

1. **Public repo from day one.** Public GitHub repository under the Foundation's (or Nodal's — OPEN) organisation. No private history to scrub later; secrets never committed, even in the first commit.
2. **Generic core, configured edge.** Anything that names an organisation, domain, membership tier, brand, or IdP belongs in `.env`, `lms.config.ts`, or the database — never in source. Rule of thumb for the agent: _if a second organisation forked this tomorrow, would they have to edit a `.ts` file to run it? If yes, it's misplaced._
3. **Standards over integrations.** SSO is plain OIDC (any compliant IdP works; better-auth is just the reference). Enrollments are a documented, versioned JSON contract over HTTPS, not a call into the members' site's internals. Storage is a directory or any S3-compatible API behind one interface. Email is SMTP. Video is behind a provider interface (Vimeo is the first implementation).
4. **One-command local setup.** `docker compose -f compose.dev.yml up` gives Postgres + a mock OIDC provider + the app with seed data. A contributor must be able to run the full lesson flow locally without any credentials from the reference deployment.
5. **Documented as a product, not a project.** `README.md` (what it is, screenshots, quickstart), `docs/deploy.md`, `docs/idp-integration.md` (how to wire your own IdP and enrollment source), `docs/adr/`. `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (responsible disclosure), `CHANGELOG.md` (Keep a Changelog), semver tags.
6. **License:** AGPL-3.0 (recommended — same as Frappe LMS, keeps hosted forks open) or MIT (maximally permissive). **OPEN.**
7. **English-first codebase and docs**; UI is i18n'd with ca/es/en shipped as the first three catalogs. Identifiers, comments, commits, ADRs in English.
8. **CI on every PR:** typecheck, lint, unit tests, migration dry-run, Playwright smoke. Dependabot/Renovate on.
9. **No telemetry, no phone-home.** Self-hosters get nothing sent anywhere by default.

---

## 1. Goals and non-goals

### Goals

- Courses made of ordered chapters made of ordered lessons.
- Lesson content types: rich text, video (provider-backed; Vimeo first), audio, PDF/attachments, assignment, quiz/form.
- Cohorts: a group of students moving through a course on a shared schedule, with drip-release of chapters/lessons by date.
- Assignments with student submissions (file and/or text) and a simple review flow for teachers.
- Quizzes/forms: multiple choice, checkbox, short text, long text; optional auto-grading for choice questions; results visible to teachers.
- Per-lesson progress tracking and a "continue where you left off" experience.
- Access to courses granted by an external system via a documented enrollment contract — the LMS never sells anything.
- Single sign-on via OIDC: a user logged into the IdP is logged into the LMS with no second login.
- Smooth lesson-by-lesson delivery is the priority UX requirement.
- Multilingual UI (catalogs; ca/es/en shipped). Course content is authored in one language per course (no per-lesson translations in v1).
- Self-hostable by a small organisation on a single VPS.

### Non-goals (explicitly out of scope for v1)

- Certificates, badges, achievements, leaderboards, gamification.
- Grades/GPA, weighted scoring, gradebooks.
- Payments, checkout, subscriptions, pricing.
- Self-registration, password reset, email verification, local passwords — all belong to the IdP.
- Live class scheduling, Zoom integration. (Discussion forums were a non-goal until ADR-011.)
- Mobile app.
- Video hosting/transcoding.
- Multi-tenancy (one organisation per deployment).

---

## 2. Stack — **DECISION**

| Concern          | Choice                                                                                                              | Notes                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Framework        | TanStack Start (React, file-based routes, server functions)                                                         | SSR + server functions replace a separate API layer for the app's own needs                                |
| Router / data    | TanStack Router + TanStack Query                                                                                    | Loaders on routes; Query for client-side mutations and cache                                               |
| Forms            | TanStack Form + Zod                                                                                                 | Zod schemas shared between server functions and forms                                                      |
| Tables (admin)   | TanStack Table                                                                                                      |                                                                                                            |
| DB               | PostgreSQL 16                                                                                                       |                                                                                                            |
| ORM              | Drizzle ORM + drizzle-kit migrations                                                                                | Schema is the source of truth; migrations committed                                                        |
| Auth             | Generic OIDC relying party (`openid-client`)                                                                        | Reference IdP: better-auth with OIDC Provider plugin. Mock IdP in docker-compose for dev                   |
| Video            | `VideoProvider` interface; `VimeoProvider` is the v1 implementation                                                 | See §5                                                                                                     |
| Files            | `StorageProvider`: local directory (default) or S3-compatible (`@aws-sdk/client-s3`)                                | Signed URLs only; the local driver honours them at `/api/storage/$token` (ADR-012)                         |
| Email            | SMTP via `nodemailer`                                                                                               | Any relay. Templates in `src/server/services/email/templates`                                              |
| Styling          | Tailwind + hand-written primitives (ADR-008); brand tokens (logo, colours, name) from `lms.config.ts`               |                                                                                                            |
| Rich text        | Markdown storage (ADR-007), edited in place with Tiptap (ADR-010)                                                   | Bare YouTube/Vimeo links become players; images via `/api/files`                                           |
| i18n             | JSON message catalogs, locale resolution order: `?lang` → cookie → IdP `locale` claim → `Accept-Language` → default | Cookie domain configurable so a parent site can set it                                                     |
| Runtime / deploy | Node 22. Official: Docker image + `compose.yml` behind a reverse proxy                                              | The reference deployment's rsync/nginx deploy is a documented _alternative_ in Appendix A, not the default |
| Repo conventions | AI-first: lean `CLAUDE.md`, ADRs under `docs/adr/`, no decorative comments, no over-engineering                     |                                                                                                            |

Configuration surface (all of it, nothing else):

- `.env`: validated at boot (`src/config/env.ts`), every variable documented in `docs/configuration.md`: `AUTH_MODE`, `ALLOW_SIGNUP`, `BREAK_GLASS_ADMIN_EMAIL`, `OIDC_*`, `ENTITLEMENT_CLAIM`, `DEFAULT_LOCALE`, `DATABASE_URL`, `SESSION_SECRET`, `ENTITLEMENTS_*`, `STORAGE_*`, `S3_*`, `SMTP_*`, `MAIL_*`, `VIMEO_ACCESS_TOKEN`, `APP_URL`, `COOKIE_DOMAIN`.
- `lms.config.ts` (committed, per-deployment fork or mounted): brand name, logo path, colour tokens, default locale, enabled locales, allowed embed domains, upload limits/mime allowlist, notification defaults, `forum` (general forum switch, post image limit, page size).

---

## 3. Identity, SSO and enrollments

### 3.1 Principle

`AUTH_MODE` selects who owns identity (ADR-013, ADR-016). In `oidc` mode the LMS is an **OIDC relying party**: it never registers anyone, never shows a password form (except for the break-glass administrator) and treats the IdP as authoritative for _who_ someone is. In `local` mode (default) it owns accounts: email + password, magic link, admin invitations, optional signup; everything below about the IdP applies to `oidc` mode only. A separate **enrollment source** (usually the same system as the IdP, but not necessarily) is authoritative for _what_ they may access. Both are external; the LMS caches.

### 3.2 SSO mechanism — **DECISION**

Authorization code + PKCE against any OIDC-compliant issuer. Discovery via `${OIDC_ISSUER}/.well-known/openid-configuration`.

Flow:

1. User hits any protected LMS route without an LMS session.
2. LMS redirects to the IdP's authorization endpoint (code + PKCE, `scope=openid profile email`).
3. If the user already has an IdP session, the IdP redirects back immediately with a code — no visible login. Otherwise the IdP shows its login and then redirects.
4. LMS (better-auth generic OIDC client, callback `/api/auth/callback/oidc`) exchanges the code for tokens, verifies the ID token against the issuer's JWKS (`iss`, `aud`, `exp`, `nonce`), and creates a better-auth session cookie (httpOnly, `Secure` over https, `SameSite=Lax`; 2 h idle, 12 h absolute).
5. The `person` row is provisioned or refreshed, keyed by issuer + `sub`. Roles are read from a configurable claim name (default `roles`); locale from `locale` claim if present. If `ENTITLEMENT_CLAIM` is set, `claims` enrollments are reconciled from that claim.

Logout: LMS clears its session and redirects to the IdP's end-session endpoint (from discovery, or `OIDC_END_SESSION_URL`) so the user is logged out of both.

Dev: `compose.dev.yml` ships a mock OIDC provider (e.g. `oidc-provider` or Dex) with three seeded users (student, teacher, admin) so contributors never need a real IdP.

`docs/idp-integration.md` must document: required claims, the roles claim, redirect URI registration, and a worked example for better-auth's OIDC Provider plugin (the reference).

### 3.3 Enrollment contract — **DECISION** (ADR-014)

Versioned JSON contract, `enrollments/v1` (full definition in `docs/entitlements-contract.md`). Two channels:

- **Pull**: `GET ${ENTITLEMENTS_PULL_URL}/{sub}` with `Authorization: Bearer ${ENTITLEMENTS_PULL_TOKEN}`. Called on login and on cache miss (TTL 15 min).
- **Push**: the enrollment source POSTs to `${APP_URL}/api/webhooks/entitlements` on any change. HMAC-SHA256 over raw body + `X-Timestamp`, `X-Signature`, `X-Event-Id` headers. LMS verifies, stores the event, reconciles, responds 200. Idempotent on `X-Event-Id`.

Payload (both channels): the person (`sub`, `email`, `name`, `locale`, `roles`) and the complete list of their enrollments, one per course (and optional cohort), each with `external_id`, `valid_from`, `valid_until` (exclusive) and `status`:

```json
{
  "version": "enrollments/v1",
  "sub": "idp-user-id",
  "email": "x@y.z",
  "name": "…",
  "locale": "ca",
  "roles": ["student"],
  "enrollments": [
    { "external_id": "ord-1-a", "course": "course-slug", "valid_until": "2027-01-31T23:00:00Z" },
    { "external_id": "ord-1-b", "course": "other-course", "cohort": "cohort-slug" }
  ]
}
```

The core never knows what a "membership tier" is and has no access rules: the source sends per-course enrollments with the `valid_until` it wants. Rows with `source = 'webhook'` are reconciled by `external_id`; `manual` rows are never touched.

Access resolution: `canSeeLesson(U, L) = enrolled(U, course(L)) AND released(L, U)`, where `enrolled` means some enrollment is `active` with `valid_from <= now < valid_until`, and `released` checks course/lesson publish state and the cohort drip schedule if U is a member of a cohort for that course. This function has an exhaustive test matrix (§9).

### 3.4 Roles

- `student`: sees enrolled courses.
- `teacher`: plus authoring of courses they're assigned to, reviewing submissions, viewing quiz results.
- `admin`: everything, plus people/enrollment inspection, webhook log, and **manual enrollments** (`enrollment.source = 'manual'`: one address, a pasted list or a whole cohort, by admins and the course's teachers; an unknown address gets an invitation in `local` mode and a placeholder `person` without `external_sub` in `oidc` mode, adopted by email at first sign-in). Manual enrollments are always allowed and never overwritten by a sync; optional write-back to the enrollment source via a configurable `ENTITLEMENTS_WRITE_URL` is a v1.1 feature (**OPEN** whether the reference deployment needs it at launch).

Roles come from the IdP claim; the LMS has no role management UI.

---

## 4. Data model (Postgres, via Drizzle)

Conventions: UUID v7 primary keys, `created_at`/`updated_at` everywhere, soft delete only where noted, slugs unique per parent. Content stored as Markdown (**OPEN**: Markdown vs. JSON rich-text doc). No table or column may carry an organisation-specific name.

### Identity mirror

- `person` — `id`, `email` (unique), `email_verified`, `name`, `locale`, `roles text[]` (`student` | `teacher` | `admin`), `external_iss` + `external_sub` (nullable, unique together), `last_seen_at`. Also the better-auth user model; `auth_session`, `auth_account`, `auth_verification` and `invitation` sit beside it (ADR-016).
- `enrollment` — `id`, `person_id`, `course_id`, `cohort_id` (nullable), `source` (`manual` | `claims` | `webhook`), `external_id` (nullable), `valid_from`, `valid_until` (nullable, exclusive), `status` (`active` | `expired` | `revoked`). Unique on (`person_id`, `course_id`, `cohort_id`, `source`) and on (`source`, `external_id`) where not null.

### Catalogue

- `course` — `id`, `slug`, `title`, `subtitle`, `description_md`, `language`, `cover_image_key`, `status` (`draft` | `published` | `archived`), `ended_at` (date live delivery ended; informational), `sort`, `forum_enabled`.
- `course_teacher` — `course_id`, `person_id`.
- `chapter` — `id`, `course_id`, `slug`, `title`, `description_md`, `sort`.
- `lesson` — `id`, `chapter_id`, `slug`, `title`, `summary`, `sort`, `status` (`draft` | `published`), `estimated_minutes`.
- `lesson_block` — `id`, `lesson_id`, `sort`, `type`, `payload jsonb`. Types:
  - `text` → `{ md }`
  - `video` → `{ provider: 'vimeo', external_id, title, duration_s }`
  - `audio` → `{ file_key, title, duration_s }`
  - `file` → `{ file_key, title, mime, size }`
  - `assignment` → `{ assignment_id }`
  - `quiz` → `{ quiz_id }`
  - `embed` → `{ url }` (allowlisted domains from config)
- `file` — `id`, `key`, `filename`, `mime`, `size`, `uploaded_by`, `sha256`.

### Assignments

- `assignment` — `id`, `course_id`, `title`, `instructions_md`, `submission_type` (`text` | `file` | `both`), `allow_resubmit bool`.
- `submission` — `id`, `assignment_id`, `person_id`, `text_md`, `file_key`, `submitted_at`, `status` (`submitted` | `reviewed` | `returned`), `teacher_comment_md`, `reviewed_by`, `reviewed_at`, `superseded_by` (nullable).

### Quizzes / forms

- `quiz` — `id`, `course_id`, `title`, `intro_md`, `kind` (`form` | `self_check`; `form` stores no score, `self_check` shows choice feedback and never gates progress), `show_answers_after_submit bool`, `pass_threshold` (nullable %, informational).
- `question` — `id`, `quiz_id`, `sort`, `type` (`single_choice` | `multi_choice` | `short_text` | `long_text`), `prompt_md`, `required bool`.
- `question_option` — `id`, `question_id`, `sort`, `label`, `is_correct bool`.
- `quiz_attempt` — `id`, `quiz_id`, `person_id`, `started_at`, `submitted_at`, `score` (nullable %), `passed bool null`.
- `quiz_answer` — `id`, `attempt_id`, `question_id`, `option_ids uuid[]`, `text`.

### Cohorts and release

- `cohort` — `id`, `course_id`, `slug`, `title`, `starts_at`, `ends_at`, `status` (`upcoming` | `active` | `closed`).
- `cohort_member` — `cohort_id`, `person_id`, `joined_at`, `role` (`student` | `teacher`).
- `cohort_release` — `cohort_id`, `chapter_id` or `lesson_id` (exactly one), `release_at`.

### Forum (ADR-011)

- `forum_thread` — `id`, `course_id` (nullable: null is the general forum), `author_person_id`, `title`, `pinned_at`, `locked_at`.
- `forum_post` — `id`, `thread_id`, `author_person_id`, `body_md`, `reply_to_post_id` (same thread), `edited_at`, `deleted_at` (soft delete keeps the slot).
- `forum_reaction` — PK (`post_id`, `person_id`); `value` (`like` | `dislike`).

The opening post is the thread's earliest post. Ordering (pinned first, then latest post) is computed.

### Progress

- `lesson_progress` — PK (`person_id`, `lesson_id`); `status` (`started` | `completed`), `last_block_sort`, `media_position_s`, `completed_at`, `updated_at`. Course progress is computed.

### Ops

- `webhook_event` — `id`, `source`, `external_id` (unique), `event_type`, `payload jsonb`, `signature_valid bool`, `processed_at`, `error`.
- `audit_log` — `id`, `actor_person_id`, `action`, `entity`, `entity_id`, `diff jsonb`.

---

## 5. Video provider — **DECISION**

Interface in `src/server/services/video/provider.ts`:

```ts
interface VideoProvider {
  id: "vimeo" | string;
  resolve(input: string): Promise<{ external_id; title; duration_s; thumbnail_url }>; // from URL or ID
  embed(external_id: string): { iframeSrc: string; playerScript?: string };
}
```

Player component wraps the provider's iframe and exposes a common event surface (`timeupdate`, `pause`, `ended`) so progress tracking is provider-agnostic.

**`VimeoProvider` (v1):**

- Videos live in the deploying organisation's Vimeo account. Recommended privacy: "Hide from Vimeo" + embed restricted to the LMS domain. Documented in `docs/video-vimeo.md`.
- `resolve()` calls `GET https://api.vimeo.com/videos/{id}` with `VIMEO_ACCESS_TOKEN` to validate ownership and fetch metadata.
- Embed via `@vimeo/player`; resume from `media_position_s`, save every ~10 s and on pause/unload, mark watched at ≥ 90 %.
- Signed per-view embeds: later hardening, not v1.

Contributors may add `YouTubeProvider`, `MuxProvider`, `SelfHostedProvider` behind the same interface. Audio and PDFs go to file storage via signed URLs after an access check.

---

## 6. Routes (TanStack Start file routes)

```
/                                   → redirect to /courses (after auth)
/auth/login                         → OIDC redirect (oidc) / → /login (local)
/auth/logout
/api/auth/*                         → better-auth (sessions, OIDC callback, magic link, invitations)
/login /signup /forgot-password /reset-password /accept-invite → local mode only (/login/break-glass: oidc mode, if configured)
/courses                            → my courses, progress
/courses/$courseSlug                → syllabus, lock states, "Continue" (tab when the forum is on)
/courses/$courseSlug/forum          → course forum: threads, /new, /$threadId
/courses/$courseSlug/$lessonSlug    → lesson player
/forum                              → general forum (lms.config.ts forum.general): threads, /new, /$threadId
/assignments/$assignmentId
/quizzes/$quizId
/cohorts/$cohortSlug

/teach
/teach/courses/$courseSlug          → editor
/teach/courses/$courseSlug/submissions
/teach/courses/$courseSlug/quizzes/$quizId/results
/teach/cohorts/$cohortSlug

/admin                              → people, enrollments, webhook log, audit log

/api/webhooks/entitlements          → POST (HMAC)
/api/files/$fileId                  → GET signed redirect (access-checked)
/api/health
```

Every loader calls `requireSession()`; content loaders call `requireLessonAccess()`; authoring routes call `requireRole()` and check `course_teacher`.

---

## 7. Key behaviours

- **Lesson player**: single column, stacked blocks, sticky prev/next, ←/→ shortcuts. Completion explicit for text/file lessons, automatic for media-only lessons at 90 %. Never block "next".
- **Locked lessons** are visible with reason and date, using i18n'd messages generated from the lock reason (never from an organisation's tier names).
- **Continue**: single primary CTA to the first non-completed, released, published lesson.
- **Enrollment sync**: refresh on login; webhook applies immediately; 15-min TTL self-heals.
- **Authoring**: course → chapter → lesson → blocks; rich-text editor over Markdown (bold, italics, headings, lists, quotes, code, links, images, video); autosave on blur; publish toggles; drag-sort (dnd-kit).
- **Uploads**: signed PUT (to the bucket, or streamed through the app with the local driver), server records `file` after HEAD. Limits and mime allowlist from config.
- **Notifications** (SMTP, minimal, per-user opt-out): submission received → teacher; feedback returned → student; chapter released → cohort; forum reply → earlier authors in the thread; new course thread → its teachers. Batched daily except feedback.
- **Forum**: threads ordered pinned-first then by latest reply; the opening post set apart, replies below; every post shows author, date, like/dislike; "cite" quotes a post and links back to it; moderators (course teachers, admins) pin, lock, rename, delete. Course forums are off until a teacher enables them; the general forum is a config switch.
- **Accessibility**: captions from the video provider; text titles/descriptions on media; full keyboard nav.

---

## 8. Security baseline

- OIDC: JWKS verification, `iss`/`aud`/`nonce`/`exp`, skew ≤ 60 s, PKCE mandatory.
- Session: 12 h absolute, 2 h sliding idle, rotate on privilege change.
- Webhooks: HMAC-SHA256, |now − ts| ≤ 5 min, store-then-process, idempotent.
- Secrets only via env; `.env.example` complete; `SECURITY.md` with disclosure address.
- Private bucket; signed URLs ≤ 5 min.
- Rate limiting on `/auth/*` and `/api/*` documented for the reverse proxy; app-level fallback limiter.
- CSP with nonces; `frame-src` built from enabled providers + embed allowlist.
- CI: dependency audit, migration dry-run; migrations applied only by explicit deploy step.

---

## 9. Repository layout

```
sota/
  README.md  LICENSE  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  CHANGELOG.md
  CLAUDE.md                      # ≤ 60 lines
  .env.example
  lms.config.example.ts
  compose.dev.yml             # dev: postgres, mock-oidc, app
  compose.yml
  Dockerfile
  docs/
    spec.md                      # this file
    deploy.md  idp-integration.md  entitlements-contract.md  video-vimeo.md
    adr/0001-oidc-relying-party.md
    adr/0002-entitlements-contract-and-cache.md
    adr/0003-video-provider-interface.md
    adr/0004-license.md
  src/
    routes/
    server/
      auth/        access/        db/          webhooks/
      services/    # courses, lessons, assignments, quizzes, cohorts, progress, files, video/, email/
    components/    # ui/ player/ editor/ syllabus/
    i18n/          # ca.json es.json en.json
    lib/
    config/        # loads + validates lms.config.ts and env with Zod
  scripts/
    seed.ts        # demo org, course, cohort, three users
  tests/
    access.test.ts       # exhaustive rule × publish-state × cohort matrix
    webhooks.test.ts
    e2e/                 # Playwright: sso-redirect, lesson-flow, submission-flow
  .github/workflows/ci.yml
```

---

## 10. Phases

**Phase 0 — Public skeleton**
Public repo, license, README stub, CI, Dockerfile + compose (Postgres, mock OIDC), Drizzle DDL from §4, health route, seed script, `CLAUDE.md`, config loader. Runs locally with `docker compose -f compose.dev.yml up`.

**Phase 1 — SSO + enrollments**
OIDC RP against the mock IdP, then against better-auth's OIDC plugin. Person mirror, pull + webhook, `enrollment`, `requireLessonAccess` with exhaustive tests. Admin route. `docs/idp-integration.md` + `docs/entitlements-contract.md` written as the code lands.

**Phase 2 — Learner core**
Courses, syllabus, lesson player with all block types, `VideoProvider` + `VimeoProvider`, signed files, progress, "Continue", lock states, i18n.

**Phase 3 — Authoring**
Teacher editor, uploads, video resolve, publish toggles, drag-sort, audit log.

**Phase 4 — Assignments, quizzes, cohorts**
Submissions + review; quiz builder + attempts + results; cohorts + drip; notifications.

**Phase 5 — Hardening + v1.0.0**
Security checklist, Playwright suite, `docs/deploy.md` verified on a clean VPS by someone other than the author, screenshots in README, tag `v1.0.0`. Then the reference deployment per Appendix A and pilot cohort.

---

## 11. Open questions for Oscar

1. Project name (and GitHub org: Foundation vs. Nodal Studio).
2. License: AGPL-3.0 or MIT.
3. Rich text: Markdown or JSON doc (Tiptap).
4. Is write-back of manual enrollments to the enrollment source needed at launch (v1) or later (v1.1)?
5. Can a cohort span several courses (a curriculum), or exactly one? Current model: one.
6. Do quizzes need a pass threshold in v1, or are they reflective forms only?
7. Audio: object storage (spec) or also on Vimeo?
8. Prod storage for the reference deployment: MinIO on the VPS or an external bucket.

---

## Appendix A — Reference deployment

Everything below is configuration for one deployment (a small foundation's members' school; names
and hosts are placeholders). None of it appears in core source.

- **Hostname:** `learn.example.org`; `COOKIE_DOMAIN=.example.org` so the main site can set the locale cookie.
- **IdP:** the members' site's better-auth with the OIDC Provider plugin. Roles claim populated from the main site's user roles.
- **Enrollment source:** the members' site. Membership tier → enrollments mapping done on the main site before emitting the contract:
  - Full tier, standalone course purchase → one enrollment per course, `valid_until` as the main site decides.
  - Middle tier → one enrollment per course with `valid_from` set to the date the main site wants access to open.
  - Entry tier → no LMS enrollments. Teachers and admins need none (role).
  - Cohort enrolment → the enrollment carries the `cohort` slug when a student is placed in a group.
- **Video:** the organisation's Vimeo account, embeds restricted to `learn.example.org`.
- **Email:** the organisation's SMTP relay, `MAIL_FROM=lms@example.org`.
- **Locales:** ca (default), es, en; same resolution order as the main site.
- **Brand:** the organisation's logo and colour tokens in `lms.config.ts`.
- **Deploy:** a VPS shared with the main site; nginx reverse proxy; either the official Docker image or the rsync + `deploy.sh` pattern already used for the main site (documented as an alternative in `docs/deploy.md`).
- **Trust boundary reminder:** the main site handles payments (Stripe/Bizum), the Fase 2 accounting sync, and the ledger. The LMS receives only `sub`, profile fields, roles and enrollments — no payment data ever crosses.

## Appendix B — Frappe LMS concept mapping

| Frappe LMS                               | This project                                       |
| ---------------------------------------- | -------------------------------------------------- |
| Course / Chapter / Lesson                | `course` / `chapter` / `lesson` + `lesson_block[]` |
| Batch / Batch enrollment                 | `cohort` / `cohort_member`                         |
| Course enrollment                        | `enrollment`                                       |
| Quiz / Quiz Question / Quiz Submission   | `quiz` / `question` / `quiz_attempt`               |
| Assignment / Assignment Submission       | `assignment` / `submission`                        |
| Certificates, Points, Badges, Jobs, Zoom | dropped                                            |
| Frappe user/role system                  | replaced by IdP claims                             |
