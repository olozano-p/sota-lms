# Status

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
