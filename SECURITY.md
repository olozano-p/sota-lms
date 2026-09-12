# Security policy

## Supported versions

The latest minor release on `main` receives security fixes. Older tags do not.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Email the maintainer at
**ol347@nyu.edu** (replace with your own address in a fork) with:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the commit or version you tested against.

You will get an acknowledgement within 5 working days and a fix or a mitigation plan within 30.
We will credit you in the changelog unless you prefer otherwise.

## Scope

SOTA is an OIDC relying party: it never stores passwords and never processes payments. Reports
about the identity provider or the entitlement source belong to those systems' operators. In
scope here: session handling, the entitlement webhook (HMAC verification, replay, idempotency),
access resolution (`canSeeLesson`), signed file URLs, content sanitisation, CSP, upload handling.

## Baseline

The controls the project commits to are listed in `docs/spec.md` §8 and verified in
`tests/` and the CI workflow: PKCE + JWKS verification with `iss`/`aud`/`nonce`/`exp` checks;
httpOnly `Secure` `SameSite=Lax` session cookies with 12 h absolute / 2 h idle expiry; HMAC-SHA256
webhooks with a 5-minute timestamp window and idempotent event ids; private object storage with
≤ 5-minute signed URLs; CSP with per-request nonces; dependency audit on every CI run.
