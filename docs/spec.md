# SOTA — Build Spec (v1)

> **Decisions log (2026-09-11).** The open questions of §11 were settled as follows; each has an
> ADR in `docs/decisions/`: name **SOTA** (repo `olozano-p/sota-lms`) · licence
> **MIT** (ADR-006) · content **Markdown** (ADR-007) · hand-written UI primitives instead of
> shadcn (ADR-008) · Postgres 16 + PGlite in tests (ADR-002) · admin-grant write-back deferred to
> v1.1 · a cohort belongs to one course · `pass_threshold` supported, nullable · audio in object
> storage · prod storage: MinIO on the VPS or an external bucket, both in `docs/deploy.md`.
> ADR file names follow the house style (`ADR-00n-topic.md`) rather than the paths in §9.

Name: **SOTA** (after Pali _sotāpanna_, "the one who has entered the stream"; repo `sota`). A lean, self-hostable, open-source course platform. Inspired by Frappe LMS's core model (Course → Chapter → Lesson, Batch → Cohort, Quiz, Assignment) but stripped to the essentials and built as a **relying party**: identity and entitlements come from an external OIDC identity provider; the LMS never owns accounts or payments.

**First production deployment and reference implementation: a small foundation's members' school**, with the foundation's own members' site as the IdP. Every feature in this spec is driven by that deployment's needs, but nothing in the codebase may be specific to it — all of its particulars live in configuration and in Appendix A.

This document is written to be handed to a coding agent. Sections marked **DECISION** are settled. Sections marked **OPEN** need Oscar's answer before implementation.

---

## 0. Open-source principles — **DECISION**

These are constraints on _how_ the project is built, not features:

1. **Public repo from day one.** Public GitHub repository under the Foundation's (or Nodal's — OPEN) organisation. No private history to scrub later; secrets never committed, even in the first commit.
2. **Generic core, configured edge.** Anything that names an organisation, domain, membership tier, brand, or IdP belongs in `.env`, `lms.config.ts`, or the database — never in source. Rule of thumb for the agent: _if a second organisation forked this tomorrow, would they have to edit a `.ts` file to run it? If yes, it's misplaced._
3. **Standards over integrations.** SSO is plain OIDC (any compliant IdP works; better-auth is just the reference). Entitlements are a documented, versioned JSON contract over HTTPS, not a call into the members' site's internals. Storage is S3-compatible. Email is SMTP. Video is behind a provider interface (Vimeo is the first implementation).
4. **One-command local setup.** `docker compose up` gives Postgres + MinIO + a mock OIDC provider + the app with seed data. A contributor must be able to run the full lesson flow locally without any credentials from the reference deployment.
5. **Documented as a product, not a project.** `README.md` (what it is, screenshots, quickstart), `docs/deploy.md`, `docs/idp-integration.md` (how to wire your own IdP and entitlement source), `docs/adr/`. `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (responsible disclosure), `CHANGELOG.md` (Keep a Changelog), semver tags.
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
- Access to courses granted by an external system via a documented entitlement contract — the LMS never sells anything.
- Single sign-on via OIDC: a user logged into the IdP is logged into the LMS with no second login.
- Smooth lesson-by-lesson delivery is the priority UX requirement.
- Multilingual UI (catalogs; ca/es/en shipped). Course content is authored in one language per course (no per-lesson translations in v1).
- Self-hostable by a small organisation on a single VPS.

### Non-goals (explicitly out of scope for v1)

- Certificates, badges, achievements, leaderboards, gamification.
- Grades/GPA, weighted scoring, gradebooks.
- Payments, checkout, subscriptions, pricing.
- Self-registration, password reset, email verification, local passwords — all belong to the IdP.
- Discussion forums, live class scheduling, Zoom integration.
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
| Files            | S3-compatible object storage (`@aws-sdk/client-s3`)                                                                 | MinIO in dev; any S3 API in prod. Signed URLs only                                                         |
| Email            | SMTP via `nodemailer`                                                                                               | Any relay. Templates in `src/server/services/email/templates`                                              |
| Styling          | Tailwind + hand-written primitives (ADR-008); brand tokens (logo, colours, name) from `lms.config.ts`               |                                                                                                            |
| Rich text        | Markdown storage (ADR-007), edited in place with Tiptap (ADR-010)                                                   | Bare YouTube/Vimeo links become players; images via `/api/files`                                           |
| i18n             | JSON message catalogs, locale resolution order: `?lang` → cookie → IdP `locale` claim → `Accept-Language` → default | Cookie domain configurable so a parent site can set it                                                     |
| Runtime / deploy | Node 22. Official: Docker image + `docker-compose.prod.yml` behind a reverse proxy                                  | The reference deployment's rsync/nginx deploy is a documented _alternative_ in Appendix A, not the default |
| Repo conventions | AI-first: lean `CLAUDE.md`, ADRs under `docs/adr/`, no decorative comments, no over-engineering                     |                                                                                                            |

Configuration surface (all of it, nothing else):

- `.env`: `DATABASE_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_END_SESSION_URL` (optional), `ENTITLEMENTS_PULL_URL`, `ENTITLEMENTS_PULL_TOKEN`, `ENTITLEMENTS_WEBHOOK_SECRET`, `S3_*`, `SMTP_*`, `MAIL_FROM`, `VIMEO_ACCESS_TOKEN`, `APP_URL`, `COOKIE_DOMAIN`.
- `lms.config.ts` (committed, per-deployment fork or mounted): brand name, logo path, colour tokens, default locale, enabled locales, `accessRules` (see §3.3), allowed embed domains, upload limits/mime allowlist, notification defaults.

---

## 3. Identity, SSO and entitlements

### 3.1 Principle

The LMS is an **OIDC relying party**. It never creates accounts, never handles passwords, and treats the IdP as authoritative for _who_ someone is. A separate **entitlement source** (usually the same system as the IdP, but not necessarily) is authoritative for _what_ they may access. Both are external; the LMS caches.

### 3.2 SSO mechanism — **DECISION**

Authorization code + PKCE against any OIDC-compliant issuer. Discovery via `${OIDC_ISSUER}/.well-known/openid-configuration`.

Flow:

1. User hits any protected LMS route without an LMS session.
2. LMS redirects to the IdP's authorization endpoint (code + PKCE, `scope=openid profile email`).
3. If the user already has an IdP session, the IdP redirects back immediately with a code — no visible login. Otherwise the IdP shows its login and then redirects.
4. LMS exchanges the code for tokens, verifies the ID token against the issuer's JWKS (`iss`, `aud`, `exp`, `nonce`), and creates its **own** short-lived session cookie (httpOnly, `Secure`, `SameSite=Lax`).
5. User record is upserted into the LMS `person` mirror table keyed by `sub`. Roles are read from a configurable claim name (default `roles`); locale from `locale` claim if present.

Logout: LMS clears its session and, if `OIDC_END_SESSION_URL` is set, redirects to the IdP's end-session endpoint so the user is logged out of both.

Dev: `docker-compose.yml` ships a mock OIDC provider (e.g. `oidc-provider` or Dex) with three seeded users (student, teacher, admin) so contributors never need a real IdP.

`docs/idp-integration.md` must document: required claims, the roles claim, redirect URI registration, and a worked example for better-auth's OIDC Provider plugin (the reference).

### 3.3 Entitlement contract — **DECISION**

Versioned JSON contract, `entitlements/v1`. Two channels, both required:

- **Pull**: `GET ${ENTITLEMENTS_PULL_URL}/{sub}` with `Authorization: Bearer ${ENTITLEMENTS_PULL_TOKEN}`. Called on login and on cache miss (TTL 15 min).
- **Push**: entitlement source POSTs to `${APP_URL}/api/webhooks/entitlements` on any change. HMAC-SHA256 over raw body + `X-Timestamp`, `X-Signature`, `X-Event-Id` headers. LMS verifies, stores the event, upserts, responds 200. Idempotent on `X-Event-Id`.

Payload (both channels):

```json
{
  "version": "entitlements/v1",
  "sub": "idp-user-id",
  "email": "x@y.z",
  "name": "…",
  "locale": "ca",
  "roles": ["student"],
  "entitlements": [
    { "scope": "course", "ref": "course-slug", "rule": "immediate", "until": null },
    { "scope": "all_courses", "ref": null, "rule": "delayed", "until": "2027-01-31" },
    { "scope": "cohort", "ref": "cohort-slug", "rule": "immediate", "until": null }
  ]
}
```

`rule` is a key into `lms.config.ts → accessRules`. The core ships two rule types and organisations declare named instances:

```ts
accessRules: {
  immediate: { type: 'immediate' },
  delayed:   { type: 'delayed_after_course_end', days: 30 },
}
```

The core never knows what a "membership tier" is. Mapping tiers → rules is the entitlement source's job (Appendix A shows the reference deployment's mapping). Adding a rule type (e.g. `fixed_date`, `n_days_after_enrol`) is a core contribution behind the same interface.

Access resolution: `canSeeLesson(U, L) = entitled(U, course(L)) AND released(L, U)`, where `released` checks course/lesson publish state, the entitlement's rule, and the cohort drip schedule if U is a member of a cohort for that course. This function has an exhaustive test matrix (§9).

### 3.4 Roles

- `student`: sees entitled/enrolled courses.
- `teacher`: plus authoring of courses they're assigned to, reviewing submissions, viewing quiz results.
- `admin`: everything, plus people/entitlement inspection, webhook log, and **local grant overrides** (`entitlement.source = 'admin'`). Local overrides are always allowed; optional write-back to the entitlement source via a configurable `ENTITLEMENTS_WRITE_URL` is a v1.1 feature (**OPEN** whether the reference deployment needs it at launch).

Roles come from the IdP claim; the LMS has no role management UI.

---

## 4. Data model (Postgres, via Drizzle)

Conventions: UUID v7 primary keys, `created_at`/`updated_at` everywhere, soft delete only where noted, slugs unique per parent. Content stored as Markdown (**OPEN**: Markdown vs. JSON rich-text doc). No table or column may carry an organisation-specific name.

### Identity mirror

- `person` — `id`, `idp_sub` (unique), `email`, `name`, `locale`, `roles text[]`, `last_seen_at`. Written only from IdP/entitlement data.
- `entitlement` — `id`, `person_id`, `scope` (`course` | `all_courses` | `cohort`), `ref` (nullable), `rule` (text key), `until` (nullable date), `source` (`external` | `admin`), `synced_at`. Unique on (`person_id`, `scope`, `ref`).

### Catalogue

- `course` — `id`, `slug`, `title`, `subtitle`, `description_md`, `language`, `cover_image_key`, `status` (`draft` | `published` | `archived`), `ended_at` (date live delivery ended; used by `delayed_after_course_end`), `sort`.
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

- `quiz` — `id`, `course_id`, `title`, `intro_md`, `kind` (`quiz` | `form`), `show_answers_after_submit bool`, `pass_threshold` (nullable %).
- `question` — `id`, `quiz_id`, `sort`, `type` (`single_choice` | `multi_choice` | `short_text` | `long_text`), `prompt_md`, `required bool`.
- `question_option` — `id`, `question_id`, `sort`, `label`, `is_correct bool`.
- `quiz_attempt` — `id`, `quiz_id`, `person_id`, `started_at`, `submitted_at`, `score` (nullable %), `passed bool null`.
- `quiz_answer` — `id`, `attempt_id`, `question_id`, `option_ids uuid[]`, `text`.

### Cohorts and release

- `cohort` — `id`, `course_id`, `slug`, `title`, `starts_at`, `ends_at`, `status` (`upcoming` | `active` | `closed`).
- `cohort_member` — `cohort_id`, `person_id`, `joined_at`, `role` (`student` | `teacher`).
- `cohort_release` — `cohort_id`, `chapter_id` or `lesson_id` (exactly one), `release_at`.

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

Contributors may add `YouTubeProvider`, `MuxProvider`, `SelfHostedProvider` behind the same interface. Audio and PDFs go to object storage via signed URLs after an entitlement check.

---

## 6. Routes (TanStack Start file routes)

```
/                                   → redirect to /courses (after auth)
/auth/callback                      → OIDC callback
/auth/logout
/courses                            → my courses, progress
/courses/$courseSlug                → syllabus, lock states, "Continue"
/courses/$courseSlug/$lessonSlug    → lesson player
/assignments/$assignmentId
/quizzes/$quizId
/cohorts/$cohortSlug

/teach
/teach/courses/$courseSlug          → editor
/teach/courses/$courseSlug/submissions
/teach/courses/$courseSlug/quizzes/$quizId/results
/teach/cohorts/$cohortSlug

/admin                              → people, entitlements, webhook log, audit log

/api/webhooks/entitlements          → POST (HMAC)
/api/files/$fileId                  → GET signed redirect (entitlement-checked)
/api/health
```

Every loader calls `requireSession()`; content loaders call `requireLessonAccess()`; authoring routes call `requireRole()` and check `course_teacher`.

---

## 7. Key behaviours

- **Lesson player**: single column, stacked blocks, sticky prev/next, ←/→ shortcuts. Completion explicit for text/file lessons, automatic for media-only lessons at 90 %. Never block "next".
- **Locked lessons** are visible with reason and date, using i18n'd messages generated from the rule type (never from an organisation's tier names).
- **Continue**: single primary CTA to the first non-completed, released, published lesson.
- **Entitlement sync**: refresh on login; webhook applies immediately; 15-min TTL self-heals.
- **Authoring**: course → chapter → lesson → blocks; rich-text editor over Markdown (bold, italics, headings, lists, quotes, code, links, images, video); autosave on blur; publish toggles; drag-sort (dnd-kit).
- **Uploads**: presigned PUT, server records `file` after HEAD. Limits and mime allowlist from config.
- **Notifications** (SMTP, minimal, per-user opt-out): submission received → teacher; feedback returned → student; chapter released → cohort. Batched daily except feedback.
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
  docker-compose.yml             # dev: postgres, minio, mock-oidc, app
  docker-compose.prod.yml
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
Public repo, license, README stub, CI, Dockerfile + compose (Postgres, MinIO, mock OIDC), Drizzle DDL from §4, health route, seed script, `CLAUDE.md`, config loader. Runs locally with `docker compose up`.

**Phase 1 — SSO + entitlements**
OIDC RP against the mock IdP, then against better-auth's OIDC plugin. Person mirror, pull + webhook, `accessRules`, `requireLessonAccess` with exhaustive tests. Admin route. `docs/idp-integration.md` + `docs/entitlements-contract.md` written as the code lands.

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
4. Is write-back of admin grants to the entitlement source needed at launch (v1) or later (v1.1)?
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
- **Entitlement source:** the members' site. Membership tier → rule mapping done on the main site before emitting the contract:
  - Full tier, standalone course purchase, teacher/admin → `rule: "immediate"`, `scope: all_courses` or `course`.
  - Middle tier → `rule: "delayed"` (`delayed_after_course_end`, 30 days), `scope: all_courses`.
  - Entry tier → no LMS entitlements.
  - Cohort enrolment → `scope: cohort` entitlements pushed when a student is placed in a group.
- **Video:** the organisation's Vimeo account, embeds restricted to `learn.example.org`.
- **Email:** the organisation's SMTP relay, `MAIL_FROM=lms@example.org`.
- **Locales:** ca (default), es, en; same resolution order as the main site.
- **Brand:** the organisation's logo and colour tokens in `lms.config.ts`.
- **Deploy:** a VPS shared with the main site; nginx reverse proxy; either the official Docker image or the rsync + `deploy.sh` pattern already used for the main site (documented as an alternative in `docs/deploy.md`).
- **Trust boundary reminder:** the main site handles payments (Stripe/Bizum), the Fase 2 accounting sync, and the ledger. The LMS receives only `sub`, profile fields, roles and entitlements — no payment data ever crosses.

## Appendix B — Frappe LMS concept mapping

| Frappe LMS                               | This project                                       |
| ---------------------------------------- | -------------------------------------------------- |
| Course / Chapter / Lesson                | `course` / `chapter` / `lesson` + `lesson_block[]` |
| Batch / Batch enrollment                 | `cohort` / `cohort_member`                         |
| Course enrollment                        | `entitlement` (external)                           |
| Quiz / Quiz Question / Quiz Submission   | `quiz` / `question` / `quiz_attempt`               |
| Assignment / Assignment Submission       | `assignment` / `submission`                        |
| Certificates, Points, Badges, Jobs, Zoom | dropped                                            |
| Frappe user/role system                  | replaced by IdP claims                             |
