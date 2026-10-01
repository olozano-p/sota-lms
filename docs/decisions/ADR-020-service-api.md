# ADR-020 · A service API for the enrollment source; one HMAC secret; one OpenAPI source

**Date** 2026-10-01 · **Status** accepted · extends ADR-004 and ADR-014

## Decision

- **A second push channel, per enrollment.** `/api/v1` (`docs/integration.md`) lets an external site
  upsert (`PUT /enrollments/{external_id}`) and revoke (`DELETE`) one enrollment at a time, read
  `GET /courses` and `GET /users/{sub}/progress`, and check `GET /health`. It writes the same
  `source = 'webhook'` rows as the complete-set channel of ADR-004 (pull and
  `POST /api/webhooks/entitlements`), keyed by `external_id`, and never reads or writes a `manual` or
  `claims` row.
- **Disabled unless configured.** `API_SERVICE_TOKEN` (at least 16 characters) is a bearer token compared in
  constant time; empty means every `/api/v1` route except `/health` answers `404`.
- **One signing secret, `WEBHOOK_HMAC_SECRET`.** When set, every authenticated `/api/v1` call must carry
  `X-Timestamp` (unix seconds, within 5 minutes) and `X-Signature` = hex HMAC-SHA256 of
  `"{timestamp}.{METHOD}.{path}.{raw body}"`. The signature covers method and path because a `DELETE` has
  no body: a body-only signature captured for one resource would be valid for every other. The same
  secret signs the older `POST /api/webhooks/entitlements` (which keeps its own `"{timestamp}.{body}"`
  string). `ENTITLEMENTS_WEBHOOK_SECRET` is a **deprecated alias**: still read when `WEBHOOK_HMAC_SECRET`
  is unset, with a boot warning, and meant to be removed once deployments have moved. `ENTITLEMENT_CLAIM`
  and `ENTITLEMENTS_PULL_*` keep their names (the pull is SOTA calling out, a different concern).
- **Placeholders by sub or email.** In `oidc` mode an unknown user becomes a `person` with no sign-in
  history: keyed by email when one is sent (adopted at first sign-in by better-auth's account linking,
  as manual placeholders are), or by `sub` alone with a made-up `u-<hash>@placeholder.invalid` address
  and `email_opt_out` set (no mail ever goes there). A sub-only placeholder cannot be found by
  better-auth, which links by email, so `completeOidcLogin` merges it into the person who signs in with
  that `sub` (enrollments and cohort places move, a colliding row is dropped, the placeholder is
  deleted, an audit row is written). In `local` mode an unknown user is a `404`: the service cannot
  register anyone there.
- **Idempotency.** PUT replaces the representation: omitted `cohort` / `valid_until` mean none, an
  omitted `valid_from` keeps the stored value. A revoked row becomes active again; a revoked row of the
  same person, course and cohort is re-keyed when a new `external_id` arrives (a renewal); an active row
  with another `external_id` for that slot, or an `external_id` that belongs to another person, is a
  `409`. A call that repeats the stored state writes nothing and no audit row. Concurrent calls are
  settled by the unique indexes (`on conflict do nothing`, then re-read).
- **Audit.** Writes live in `src/server/mutations/service-enrollments-core.ts`, take a `ServiceActor`
  that only `requireService()` can mint, and append `audit_log` rows with `actor_person_id = null` and
  `diff.actor = "service:api"`.
- **One source for contract and document.** Each route is declared once (`src/server/api/v1/routes.ts`)
  with zod schemas for its parameters, body and responses; the dispatcher validates with them and
  `/api/v1/openapi.json` is generated from them (`z.toJSONSchema`). A test asserts the registry and the
  document list the same operations and that every response matches its schema.

## Why

A site that sells memberships wants to say "this order enrolls this person" and "this order was refunded"
without sending the person's complete set of enrollments each time, and without SOTA calling back into
its internals. Signing method and path closes the replay gap that a body-only HMAC leaves on bodiless
requests. One secret and one route registry keep the deployment's configuration and the documentation
from drifting.

## Consequences

- Do not run the complete-set channels (pull, `POST /api/webhooks/entitlements`) and the service API for
  the same people: the complete-set payload revokes `webhook` rows it does not list, API rows included.
  Pick one per deployment (or use disjoint populations); both may coexist with `claims`.
- A captured request can be replayed within the 5-minute window. Replays are idempotent, but a replayed
  `PUT` after a later `DELETE` of the same id would reactivate it inside that window. SOTA keeps no
  nonce store; keep the window short on the sender (it is bound by `X-Timestamp`) and serve the API over
  HTTPS.
- Placeholder people appear in the admin and teacher listings with a synthetic address until they
  sign in.
- Rejected: a new `api` enrollment source (the brief and the existing reconciler share `webhook`);
  per-enrollment event ids (the `external_id` already is the idempotency key); signing only the body.
