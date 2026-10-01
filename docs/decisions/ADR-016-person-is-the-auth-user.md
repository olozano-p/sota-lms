# ADR-016 · `person` is the better-auth user; roles keep their names; sessions are better-auth's

**Date** 2026-10-01 · **Status** accepted · implements ADR-013

## Decision

- **One identity row.** better-auth's `user` model is configured onto the existing `person` table
  (`user.modelName = "person"`) instead of adding a `user` table and linking the two. Every table
  still references `person.id`; better-auth adds `auth_session`, `auth_account` (a `credential`
  row holds the password hash, an `oidc` row the link to the IdP) and `auth_verification`. Ids are
  UUID v7 like the rest. `person.email` is unique and stored lower-case; `person.idp_sub` became
  nullable `external_sub`, with `external_iss`, unique together when a sub is present. People who
  exist only locally have neither.
- **Roles keep the stored names `student | teacher | admin`.** The brief's `learner | instructor`
  are accepted from the IdP, the claim and the webhook and mapped (`src/server/auth/roles.ts`);
  anything unknown is dropped, so a claim can never mint a role SOTA does not define. Cohort
  membership roles (`student | teacher`) and per-course teachers (`course_teacher`) are unchanged.
  Renaming the stored values would have touched every guard, i18n key and route for no behavioural
  gain.
- **Roles are read from `person` on every request.** There is no role snapshot on the session, so
  a promotion or demotion by an admin, the IdP or the sync applies at once and the old
  "role change rotates the session" code is gone. `roles`, `locale` and `external_*` are
  better-auth additional fields with `input: false`: no endpoint accepts them from a client.
- **Sessions.** better-auth cookie `sota.session_token` (host-only, `HttpOnly`, `SameSite=Lax`,
  `Secure` over https), 2 h idle via `expiresIn`/`updateAge`, no cookie cache so revocation is
  immediate. The 12 h absolute cap (docs/spec.md §8) is applied in `currentUser()` from
  `session.createdAt`, because the library only models idle expiry.
- **OIDC tokens at rest.** Only the ID token is kept (it is the `id_token_hint` of RP-initiated
  logout); access and refresh tokens are nulled by an account hook. The ID token is verified by the
  library against the discovery document's JWKS (signature, `iss`, `aud`, `exp`, `nonce`); a
  provider whose discovery lacks `jwks_uri` or `issuer` is refused rather than trusted unverified.
- **Identity and claims after sign-in** run in an after-callback hook (`completeOidcLogin`): the
  library's own profile mapping cannot set `input: false` fields, so the verified claims are handed
  from `getUserInfo` to the hook through a short-lived in-process map keyed by `sub`. If writing
  identity or roles fails, the new session is deleted (fail closed); enrollment sync failures are
  logged and do not block sign-in.
- **Writers of `person`.** better-auth (sign-up, magic link, OIDC), `createInvitation` and the
  `replaceRoles` mutation (admin, audited), `upsertCredentialPerson` (`pnpm create-admin`),
  `applyEnrollmentPayload` (pull and webhook), and the sign-in hooks (`last_seen_at`; identity,
  roles and locale after an OIDC sign-in).

## Why

A second `user` table would need a 1:1 link kept in step by hooks, a webhook person (created before
anyone signs in) would have no user to link to, and every query would join twice. Making `person` the
user model keeps the one-row invariant; the cost is that the library's table names differ from its
defaults and that the migration was written by hand (`RENAME COLUMN idp_sub TO external_sub`).

## Consequences

- Admins may manage roles only in `local` mode; in `oidc` mode the IdP is authoritative and the
  next sign-in overwrites them.
- A person adopted by email (created by the webhook before the first sign-in, or by an admin invitation)
  is linked on first OIDC login because `oidc` is a trusted provider and local email verification
  is not required for linking: the IdP is the authority on who owns an address.
- Dropping the old `session` table signs everyone out once, at migration time.
