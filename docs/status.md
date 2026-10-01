# Status

## 2026-10-01 · Phase 3 — theming (ADR-019) and Phase 2 cleanups

- **Cleanups.** Enrollment email lookup is case-insensitive (`lower(person.email)`); `isUnchanged`
  also compares `validFrom`; the "N release dates" and outcome labels are neutral wording in ca/es/en;
  migration `0005` adds `quiz_kind_chk`; `compose.yml` takes `SOTA_IMAGE` with the placeholder default
  `ghcr.io/OWNER/sota:latest` (docs/deploying.md) and nothing in the repo names a person or deployment
  (the footer link default is gone: `projectUrl` is a theme field, null by default).
- **Theme directory** (`THEME_DIR`, default `./theme`, layered over `src/theme/default/`): `theme.json`
  (zod, strict, CSS-safe grammars), `custom.css` last, `messages/*.json` deep-merged over the typed
  catalogues, `emails/*.html` (`layout.html` or per kind, `{{name}}` escaped / `{{{lines}}}`), `assets/`
  at `/theme/assets/*` (segment grammar, realpath containment, type allow-list, nosniff, sandboxed
  SVG), `slots/<Name>.tsx` for seven slots. Boot (`serve.mjs`), `vite dev|build` and
  `pnpm sota validate-theme [dir] [--strict]` fail with every problem listed; `validate-config` summarises it.
- **Slots are compiled in** by a Vite plugin (virtual module, theme file else default); everything else
  is runtime. Trade-off and rejected alternatives: ADR-019. The image carries the theme it was built
  with as `/app/theme` (`--build-arg THEME_DIR`); a bind mount replaces all but the slots.
- **Brand left `lms.config.ts`** (`brand`, `contactEmail`, `locales.default` are rejected with a pointer
  to `theme.json`). `src/styles.css` holds no raw colours or font stacks; tokens (colour, font, radius,
  `--spacing`, content width, prose measure) come from `theme.css`; Tailwind maps to them; derived
  tokens (card, border, muted...) follow ink and paper unless the theme sets them.
- **Examples** `examples/themes/ledger` and `terminal` (different fonts, palette, radii, widths, Header
  slot, messages, mail layout); `src/theme/examples.test.ts` loads both and asserts every token family differs;
  CI validates both with `--strict`. Screenshots of default, ledger and terminal (landing, login,
  courses, course, lesson, lesson dark) were taken and look radically different.
- Docs: `docs/theming.md` (every field, every slot contract), `docs/configuration.md`, `docs/DESIGN.md`, `CLAUDE.md`.
- Not done / left: signing in under `vite dev` returns 500 (`withClientIp` in `src/server/client-ip.ts`
  hits a private-field error with `new Request`; pre-existing, found by the screenshot run; production
  build signs in fine); `pnpm e2e` and the Docker image build were not run; mobile widths, the assets
  route against a real file in a browser, contrast of every example's derived muted text and the
  Spanish/Catalan message overrides were not checked visually; messages cannot add keys, only reword;
  a theme that sets an optional derived token in one mode only gets a warning, not an error.

## 2026-10-01 · Phase 1 exit and Phase 2 — enrollment tools, drip rule, deploy walkthrough (ADR-018)

- **Manual enrollment** (`mutations/enrollments.ts` + `enrollments-core.ts`): one address or a pasted
  list (course tab _Enrollments_, cohort page), and "enroll the whole cohort". Local mode invites
  unknown addresses; oidc mode inserts a placeholder person with null `external_sub`, adopted by email
  at first sign-in (tested against the in-process fake IdP). Authorised by `requireCourseTeacher`,
  audited per call.
- **Drip generator** (`lib/drip.ts`, `cohorts-core.ts`, cohort page panel): writes chapter-level
  `cohort_release` rows from a start date, N chapters every D days, in the deployment time zone;
  replaces earlier chapter releases after confirmation.
- **Assignments, quizzes, review** verified, not rebuilt: text/file/both submissions with resubmit,
  reviewer note + `reviewed_at`/`reviewed_by`, review list now filterable by cohort. Quiz kind is
  `form | self_check` (migration 0004); a form stores no score.
- **Locale order** kept as in CLAUDE.md and now a tested pure function (`lib/locale-resolve.ts`);
  the person's stored locale is the IdP-claim step. Every UI string goes through the typed catalogues.
- **`pnpm sota`** (`scripts/sota.ts`): migrate, seed, create-admin, validate-config;
  validate-theme exits 2 "not implemented" until Phase 3. The image runs it.
- **Deployment**: root `compose.yml` (image + Postgres), dev stack moved to `compose.dev.yml`,
  `docs/deploying.md` followed on an empty database with only `compose.yml` and a `.env`: admin via the
  CLI, course created, learner invited by enrollment, accepted, finished the lesson (100%).
- **Defects found while doing so, fixed**: `/admin` and the new enrollments page crashed in the
  browser ("Buffer is not defined": server code reachable from the client through plain exports in
  mutation files, now `*-core.ts`); better-auth's limiter used one shared bucket for all clients
  (now keyed on the trusted client address); the image lacked `src/server/auth` for `create-admin`.
- Integration test for the phase exit: `tests/cohort-journey.test.ts` (three learners, weekly drip on
  a faked clock, a reviewed assignment, a self-check, 100% progress).
- Not done / left: the image is not published (no release workflow; build it locally, see
  `docs/deploying.md`); `/app/theme` is only a reserved mount; server error messages from mutations
  are English strings (the UI shows a generic or the raw text); no per-teacher cap on invitation mail;
  `pass_threshold` is still stored though nothing gates on it; the interactive password prompt of
  `create-admin` was not exercised inside the container (the `ADMIN_PASSWORD` path was).

## 2026-10-01 · Phase 1 — two auth modes with better-auth (ADR-013, ADR-016, ADR-017)

- `AUTH_MODE=local|oidc`, validated at boot with Zod (`src/config/env.ts`, `docs/configuration.md`
  lists every variable; `.env.example` updated). The own session/OIDC code (`oidc.ts`, `login.ts`,
  HMAC cookie, `session` table) is gone; better-auth sessions serve both modes (`src/server/auth/auth.ts`).
- Migration `0003` (hand-adjusted before it was applied): `person` is the better-auth user
  (`idp_sub` renamed to nullable `external_sub`, `external_iss`, `email_verified`, unique email),
  new `auth_session`, `auth_account`, `auth_verification`, `invitation`; `course.external_ref` and
  `cohort.external_ref` (unique, nullable); `notification.to_email` with nullable `person_id`.
  The old `session` table is dropped (everyone signs in again).
- Local mode: email + password (confirmation required), magic link, admin invitations (7-day one-time
  link, `mutations/people.ts`), `ALLOW_SIGNUP`, first sign-up becomes admin until one exists,
  `pnpm create-admin`. Account mail uses the notification queue and is flushed at once.
- OIDC mode: generic OIDC client against `OIDC_ISSUER` (verified ID token, PKCE, nonce), person keyed by
  issuer + sub and refreshed each sign-in, roles from `OIDC_ROLES_CLAIM` (`learner`/`instructor`
  accepted as aliases of `student`/`teacher`), `ENTITLEMENT_CLAIM` reconciles `claims` enrollments
  (`access/claims.ts`), pull/webhook channel unchanged apart from resolving courses and cohorts by
  slug or `external_ref`, break-glass admin, RP-initiated logout from discovery. No local login,
  signup, magic link or invitation endpoint exists in this mode.
- Rate limits for credential, magic-link, recovery and invitation endpoints (`src/start.ts` middleware).
- Tests: `tests/auth-local.test.ts`, `tests/auth-oidc.test.ts` (in-process fake IdP), env, claims,
  rate limit, webhook adoption and `external_ref`.
- Not done / left: per-address throttling of magic-link mail; the "one chapter per week" drip rule;
  the person column `entitlements_synced_at` keeps its name; the first-admin rule has a race between
  two simultaneous first sign-ups (use `pnpm create-admin`); an IdP that is down when the server
  boots makes OIDC sign-in fail until it is reachable again (retried per request, not a restart).

## 2026-10-01 · Phase 1 — `enrollment` replaces `entitlement` (ADR-014)

- Migration `0002` creates `enrollment` and drops `entitlement` (test data, no copy). Access is
  `canSeeLesson()` over enrollments: `active` and inside `valid_from..valid_until`, cohort drip as
  before. `all_courses`, `accessRules` and `delayed_after_course_end` are removed from rules,
  config schema, `lms.config.ts` and the lock reasons (now: not enrolled, expired, not yet released).
- The sync (`access/enrollments.ts`, payload `enrollments/v1`, same webhook URL and `ENTITLEMENTS_*`
  variables) reconciles only `webhook` rows by `external_id`; rows no longer listed are `revoked`.
  Admin grants are `manual` rows (`mutations/enrollments.ts`); adding a student to a cohort enrolls them.
- Admin people page shows non-manual rows read-only with source and `external_id`.
- Left for later: nothing writes `claims` rows yet (login sync uses the pull channel); the person
  column `entitlements_synced_at` keeps its name; the generated "one chapter per week" drip rule is
  not built.

## 2026-10-01 · Phase 0 — audit and decisions

- `docs/audit.md` compares the repo with the brief. Skeleton items (strict TS, Drizzle migrations,
  Dockerfile, compose, CI, env config) already existed.
- ADR-013 (auth modes), ADR-014 (enrollment), ADR-015 (brief adopted, deviations).
- Next: Phase 1 — start with the `enrollment` migration and the better-auth integration.
