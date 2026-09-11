# ADR-004 · Entitlements come from outside through a versioned contract; Lodrö caches

**Date** 2026-09-11 · **Status** accepted

## Decision

What a person may access is decided by an external entitlement source and delivered through the
`entitlements/v1` JSON contract (`docs/entitlements-contract.md`) over two channels: pull on login
and on a 15-minute TTL, and a signed webhook on change. Each entitlement names a _rule_ declared
in `lms.config.ts → accessRules`; the core knows rule **types** (`immediate`,
`delayed_after_course_end`, `fixed_date`) and nothing about tiers. Access is resolved by one pure
function, `canSeeLesson()` (`src/server/access/rules.ts`), covered by the matrix in
`tests/access.test.ts`. Admins may add local grants (`source = 'admin'`) that the sync never
touches; writing them back to the source is deferred to v1.1.

## Why

- Payments, tiers and cohorts live where the money is; duplicating that logic here would make
  two systems disagree about who paid.
- A named-rule indirection keeps organisation vocabulary out of source and lets a fork add a
  rule type as a core contribution instead of a patch.
- Caching with a TTL plus a push channel gives instant changes when the source is well behaved
  and self-healing when it is not.

## Consequences

- The source must send **complete** payloads; Lodrö replaces external rows rather than merging.
- Lock reasons are generated from the rule type (i18n keys), never from the source's tier names.
- Rejected: Lodrö calling the members' site's internal API; storing "unlocked" flags per lesson;
  a shared database between the two systems.
