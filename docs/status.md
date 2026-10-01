# Status

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
