# ADR-013 · Two auth modes: local accounts or OIDC relying party

**Date** 2026-10-01 · **Status** accepted · Supersedes ADR-003

## Decision

SOTA runs in one of two modes, selected by `AUTH_MODE` and validated at boot:

- `oidc` — today's behaviour (ADR-003): authorization code + PKCE, `person` mirrored by `iss + sub`,
  no local login except `BREAK_GLASS_ADMIN_EMAIL`, no signup form.
- `local` — email + password and magic link, admin invites, `ALLOW_SIGNUP` toggle, first user becomes
  admin (or `create-admin`). Needs nothing but Postgres.

The auth library is better-auth in both modes; it owns the account tables. SOTA's own `person`
profile (locale, roles, sub) stays the row every other table references. The mode switch decides
which elements the UI renders; local login and signup components are not rendered in `oidc` mode.

## Why

A centre must be able to run SOTA alone (Phase 1 acceptance: `docs/deploying.md` with only Postgres)
and also plug into a site that owns identity. One codebase, two configurations.

## Consequences

- ADR-003's "rejected and not to be re-proposed" list is withdrawn for better-auth and magic links by
  this decision; SAML and student API keys remain rejected.
- The own-session design (HMAC cookie → `session` row) is replaced by better-auth sessions in both
  modes; the migration happens in Phase 1/4 with the OIDC tests kept green throughout.
- `person.idp_sub` becomes nullable (`external_sub`) because local users have no subject.
