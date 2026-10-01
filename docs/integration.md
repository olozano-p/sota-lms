# Integrating an external site

How a site that sells or manages memberships (the _enrollment source_) plugs into SOTA, which never
sells, registers or authenticates anyone itself (ADR-003, ADR-013, ADR-014). Three things to set up,
in this order:

1. **Identity**: SOTA is an OIDC client of your IdP (`AUTH_MODE=oidc`).
2. **Enrollments**: your site tells SOTA who may open which course, through the service API below
   (or, alternatively, the complete-set channels in `docs/entitlements-contract.md`, or an ID-token claim).
3. **Reading back**: your site may ask for the courses and a person's progress.

The machine-readable contract of the service API is `GET {APP_URL}/api/v1/openapi.json`
(OpenAPI 3.1, generated from the same schemas that validate requests; no authentication).

## 1. Register SOTA as an OIDC client

| Setting              | Value                                                                           |
| -------------------- | ------------------------------------------------------------------------------- |
| Flow                 | Authorization code with PKCE (S256), confidential client, secret by HTTP Basic. |
| Redirect URI         | `{APP_URL}/api/auth/callback/oidc`                                              |
| Post-logout redirect | `{APP_URL}/`                                                                    |
| Scopes               | `openid profile email` (plus whatever releases your roles claim)                |
| Signing              | Asymmetric (RS256, ES256…), JWKS and `issuer` in the discovery document         |

In `.env` of SOTA: `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Claims in
the ID token (or userinfo): `sub`, `email`, `name`, optionally `locale` and a roles array
(`student`, `teacher`, `admin`; `learner` and `instructor` are accepted). Full details, a better-auth
provider example and the go-live checklist: `docs/idp-integration.md`.

The `sub` is the join key: the `user.sub` you send to the API must be the `sub` your IdP puts in the
ID token.

## 2. The service API

Enable it in SOTA's `.env`:

```
API_SERVICE_TOKEN=<openssl rand -hex 32>
WEBHOOK_HMAC_SECRET=<openssl rand -hex 32>     # optional but recommended: signed requests
```

With `API_SERVICE_TOKEN` empty every `/api/v1` route except `/api/v1/health` answers `404`. With
`WEBHOOK_HMAC_SECRET` set, every authenticated call must also be signed (below). Always use HTTPS.

All bodies are JSON (`Content-Type: application/json`, at most 64 KiB), answers are JSON (except the rate limiter's plain-text `429`), and every
error has the shape `{"error": {"code": "...", "message": "...", "issues": [...]}}`. Calls are rate
limited to 300 a minute per client address (`429` with `Retry-After`).

| Method and path                            | Auth    | Purpose                                                                                                                       |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/v1/enrollments/{external_id}`    | service | Create or update an enrollment (idempotent upsert).                                                                           |
| `DELETE /api/v1/enrollments/{external_id}` | service | Revoke it (idempotent).                                                                                                       |
| `GET /api/v1/users/{sub}/progress`         | service | Lessons completed per course.                                                                                                 |
| `GET /api/v1/courses`                      | service | `slug`, `external_ref`, `title`, `status` of every course.                                                                    |
| `GET /api/v1/health`                       | none    | `{"status":"ok","version":"…","db":"ok","dbLatencyMs":3}`, or `503` with `"status":"degraded"`. Also served at `/api/health`. |
| `GET /api/v1/openapi.json`                 | none    | This contract.                                                                                                                |

### Authentication

```
Authorization: Bearer {API_SERVICE_TOKEN}
X-Timestamp: 1790000000                 # unix seconds; only when WEBHOOK_HMAC_SECRET is set
X-Signature: 9f2c…                      # hex HMAC-SHA256; only when WEBHOOK_HMAC_SECRET is set
```

`401` for a missing or wrong token, a missing or wrong signature, or a timestamp more than 5 minutes
from the server clock; the `code` says which (`unauthorized`, `invalid_signature`, `stale_timestamp`).
The token is checked first, in constant time.

### Signature

```
signature = hex( HMAC_SHA256( WEBHOOK_HMAC_SECRET,
                              "{X-Timestamp}.{METHOD}.{path}.{raw body}" ) )
```

- `METHOD` is upper case (`PUT`); `path` is the request path exactly as sent, from the leading
  `/api/v1`, without scheme, host or query string (`/api/v1/enrollments/ord-1042-line-1`; percent-encode
  an `external_id` the way you send it and sign the encoded form); `raw body` is the bytes you send, empty
  for `GET` and `DELETE`. The server signs the path it receives, so a proxy that rewrites the path breaks signatures: keep `/api/v1` intact. Sign the exact string you transmit: re-serialising the JSON invalidates it.
- Method and path are part of the signature so that a signature captured for one request cannot be
  reused for another resource (a `DELETE` has no body to bind it to).
- The older `POST /api/webhooks/entitlements` signs `"{timestamp}.{body}"` and also needs `X-Event-Id`
  (`docs/entitlements-contract.md`); it uses the same secret.

Shell:

```sh
BASE=https://learn.example.org
M=PUT P=/api/v1/enrollments/ord-1042-line-1
BODY='{"user":{"sub":"idp-user-77"},"course":"intro-1","cohort":"autumn-26","valid_until":"2027-06-30T22:00:00Z"}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.$M.$P.$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_HMAC_SECRET" -hex | sed 's/^.* //')
curl -i -X "$M" "$BASE$P" \
  -H "Authorization: Bearer $API_SERVICE_TOKEN" -H "X-Timestamp: $TS" -H "X-Signature: $SIG" \
  -H 'Content-Type: application/json' --data "$BODY"
```

Node:

```js
import { createHmac } from "node:crypto";

async function sota(method, path, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.WEBHOOK_HMAC_SECRET)
    .update(`${ts}.${method}.${path}.${body}`)
    .digest("hex");
  const res = await fetch(`${process.env.SOTA_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.API_SERVICE_TOKEN}`,
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": signature,
    },
    body: body || undefined,
  });
  return { status: res.status, body: await res.json() };
}

await sota("PUT", "/api/v1/enrollments/ord-1042-line-1", {
  user: { sub: "idp-user-77" },
  course: "intro-1",
});
```

### `PUT /api/v1/enrollments/{external_id}`

```json
{
  "user": { "sub": "idp-user-77", "email": "ada@example.org", "name": "Ada" },
  "course": "intro-1",
  "cohort": "autumn-26",
  "valid_from": "2026-09-01T00:00:00Z",
  "valid_until": "2027-06-30T22:00:00Z"
}
```

| Field         | Meaning                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `external_id` | Your id for this enrollment (order line, subscription…), in the path. The idempotency key; unique among `webhook` rows. At most 200 characters.        |
| `user`        | `sub` and/or `email` (at least one). `name` is used only to label a new placeholder.                                                                   |
| `course`      | Course slug **or** `external_ref` (set by an admin on the course). Slug wins when both match.                                                          |
| `cohort`      | Optional cohort slug or `external_ref`, which must belong to the course. A cohort-scoped enrollment also places the person in the cohort as a student. |
| `valid_from`  | ISO 8601 instant with offset. Default: now on creation; later calls without it keep the stored value.                                                  |
| `valid_until` | ISO 8601 instant with offset, **exclusive**. Absent or `null`: open-ended.                                                                             |

Answers: `201` created, `200` updated or already identical (`"changed": false`):

```json
{
  "enrollment": {
    "external_id": "ord-1042-line-1",
    "course": { "slug": "intro-1", "external_ref": "crs-100" },
    "cohort": { "slug": "autumn-26", "external_ref": null },
    "user": { "sub": "idp-user-77", "email": "ada@example.org", "pending": true },
    "status": "active",
    "valid_from": "2026-09-01T00:00:00.000Z",
    "valid_until": "2027-06-30T22:00:00.000Z"
  },
  "created": true,
  "changed": true
}
```

`pending` is true until the person has signed in for the first time.

Errors: `404` `course_not_found`, `cohort_not_found`, `user_not_found` (`AUTH_MODE=local` and the
user does not exist); `409` `external_id_conflict` (that id belongs to another user),
`duplicate_enrollment` (the user already has another _active_ enrollment for that course and cohort),
`identity_conflict` (the email belongs to a person with a different `sub`); `422` `cohort_course_mismatch`,
`validation_failed` (with `issues`); `400` `invalid_json`; `413` `payload_too_large`.

### `DELETE /api/v1/enrollments/{external_id}`

Marks the enrollment `revoked` (the row is kept for the history). Answers `200`
`{"external_id": "...", "found": true, "changed": true, "status": "revoked"}`; an unknown or already
revoked id answers `200` with `"changed": false` (and `"found": false` when there was no such row).

### `GET /api/v1/users/{sub}/progress`

```json
{
  "user": { "sub": "idp-user-77", "email": "ada@example.org", "name": "Ada" },
  "courses": [
    {
      "slug": "intro-1",
      "external_ref": "crs-100",
      "title": "Introduction",
      "lessons_total": 12,
      "lessons_completed": 5,
      "ratio": 0.4167,
      "last_activity_at": "2026-10-01T09:00:00.000Z",
      "completed_at": null
    }
  ]
}
```

Courses the person holds an enrollment in (any source or status) or has progress in; lessons are the
_published_ ones; `completed_at` is when the last published lesson was completed, `null` until all are.
`404` `user_not_found` when no person has that `sub`.

### Idempotency and semantics

- `PUT` is an upsert by `external_id`: send it again as often as you like. A repeat of the stored state
  writes nothing (`"changed": false`). It **replaces** the representation: leaving out `cohort` or
  `valid_until` clears them; leaving out `valid_from` keeps it.
- `PUT` after `DELETE` of the same id reactivates the enrollment (`created: false, changed: true`). A new
  `external_id` for a course and cohort whose enrollment was revoked renews that row under the new id.
- Concurrent identical calls are safe: one creates, the others see the result.
- `external_id` is yours alone: one that belongs to another user is a `409`, never a silent move.
- **Unknown users.** With `AUTH_MODE=oidc`, SOTA creates a placeholder person: with `user.email` it is
  keyed by that address and adopted when someone signs in with it; with only `user.sub` it is keyed by
  the `sub` (shown in the admin with a made-up `…@placeholder.invalid` address that never gets mail)
  and merged into the person who signs in with that `sub`, whatever address the IdP releases. Either
  way the enrollment is waiting for them at first sign-in.
- **Sign-in merge.** A `sub`-only placeholder is merged at first sign-in: its enrollments (of every source) move to the person, and where both hold a row for the same course, cohort and source the better one (active, then the later end) is kept.
- **Other sources.** `manual` (admins) and `claims` (ID token) enrollments are never read, changed or
  deleted by the API. Revoking an API enrollment does not close a course the person also holds a
  `manual` or `claims` enrollment for.
- **One channel per population.** The complete-set channels (pull, `POST /api/webhooks/entitlements`)
  revoke `webhook` rows they do not list, API rows included. Use the API _or_ those for the same people.
- Everything the API writes is in the audit log (`/admin/audit`) with the actor `service:api`, and
  visible, read-only, on the course's _Enrollments_ tab and on the person's page with its origin
  (`webhook`) and `external_id`.

### Replay

The timestamp bounds a captured request to 5 minutes. SOTA stores no nonces, so within that window
the same signed request can be replayed: replaying a `PUT` or `DELETE` is harmless on its own (they are
idempotent), but a replayed `PUT` after a later `DELETE` of the same id would reactivate it. Keep your
clocks in sync (NTP), use HTTPS, and do not log signed requests together with the secret.

## 3. Trying it

`docker compose -f compose.dev.yml up` starts the dev stack with `API_SERVICE_TOKEN` and
`WEBHOOK_HMAC_SECRET` set (see the file) and a mock IdP with a learner, `mock-service-learner`, who
has no enrollment of their own:

```sh
# push the enrollment before they have ever signed in…
… PUT /api/v1/enrollments/demo-1 '{"user":{"sub":"mock-service-learner"},"course":"introduccio-a-la-contemplacio"}'
# …sign in as "Sergi Servei" at http://localhost:3003: the course is there. Then revoke it:
… DELETE /api/v1/enrollments/demo-1
```

`pnpm e2e` runs this flow (`tests/e2e/service-api.spec.ts`); `tests/service-api-oidc.test.ts` runs it
in-process against a fake IdP.
