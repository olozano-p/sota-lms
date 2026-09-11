# ADR-003 · Lodrö is an OIDC relying party with its own short session

**Date** 2026-09-11 · **Status** accepted

## Decision

Authentication is delegated to an external OpenID Connect provider (authorization code + PKCE,
discovered from the issuer, verified with `openid-client`). Lodrö keeps a `person` mirror keyed by
`sub` and its own opaque session cookie (HMAC-signed id → `session` row; 12 h absolute, 2 h idle)
so that authorization does not depend on the IdP being up for every request. Roles come from a
configurable ID-token claim (default `roles`), with the userinfo endpoint as fallback. There is no
sign-up, password, verification, reset or role UI anywhere in the codebase.

## Why

- The organisations Lodrö serves already have a members' site with accounts, tiers and payments;
  a second account store would fork identity and invite drift.
- Plain OIDC keeps the core generic: better-auth is the reference IdP, but Keycloak or Entra ID
  work unchanged (`docs/idp-integration.md`).
- An own session lets us enforce our expiry policy and rotate on privilege change without
  depending on the IdP's session semantics.

## Consequences

- The first login is always a redirect; SSO makes it invisible when the IdP session exists.
- Rejected and not to be re-proposed: better-auth (or any auth library) _inside_ Lodrö as the
  account store; magic links; API keys for students; SAML (no candidate deployment needs it).
- Dev needs an IdP: `dev/mock-idp` (node-oidc-provider) is part of the one-command setup.
