# Entitlements contract — `entitlements/v1`

Lodrö never decides _who may access what_ on its own. An external **entitlement source** (usually
the system that also runs your identity provider, but not necessarily) tells it, through a small
versioned JSON contract with two channels. Both are required for a production deployment; the
mock in `dev/mock-idp/` implements both.

## Payload

```json
{
  "version": "entitlements/v1",
  "sub": "idp-user-id",
  "email": "x@y.z",
  "name": "Full Name",
  "locale": "ca",
  "roles": ["student"],
  "entitlements": [
    { "scope": "course", "ref": "course-slug", "rule": "immediate", "until": null },
    { "scope": "all_courses", "ref": null, "rule": "delayed", "until": "2027-01-31" },
    { "scope": "cohort", "ref": "cohort-slug", "rule": "immediate", "until": null }
  ]
}
```

| Field                  | Meaning                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `sub`                  | The OIDC subject. The join key between the IdP and the entitlement source.                                    |
| `email`, `name`        | Mirrored into `person`. Lodrö never edits them.                                                               |
| `locale`               | Optional; one of the enabled locales. Used when the ID token carries no `locale` claim.                       |
| `roles`                | `student`, `teacher`, `admin`. The IdP's roles claim wins right after login; the source's win on later syncs. |
| `entitlements[].scope` | `course` (one course), `all_courses`, `cohort` (access through membership of that cohort).                    |
| `entitlements[].ref`   | Course slug or cohort slug; `null` for `all_courses`.                                                         |
| `entitlements[].rule`  | A key into `lms.config.ts → accessRules`. **Not** a tier name: the source maps its tiers to rule names first. |
| `entitlements[].until` | Inclusive last day of access, `YYYY-MM-DD` in the deployment's `timeZone`, or `null`.                         |

Each payload is the **complete** set of external entitlements for that person: Lodrö replaces
all `source = 'external'` rows with it. Grants made by an admin in Lodrö (`source = 'admin'`) are
never touched by the contract.

## Rules

The core ships three rule types; a deployment declares named instances in `lms.config.ts`:

```ts
accessRules: {
  immediate: { type: "immediate" },
  delayed:   { type: "delayed_after_course_end", days: 30 },
  autumn:    { type: "fixed_date", date: "2026-10-01" },
}
```

- `immediate` — access as soon as the lesson is published (and released to the cohort, if any).
- `delayed_after_course_end` — access `days` after the course's `ended_at` date; until the course
  has an end date the lesson shows «available after the course ends».
- `fixed_date` — access from local midnight of `date`.

Several entitlements may match one course; the earliest availability wins. Cohort drip never
opens a lesson _earlier_ than the entitlement rule does. Unknown rule keys deny access and show up
in the admin's entitlement view — fix the config or the source, never the core.

## Pull channel

```
GET {ENTITLEMENTS_PULL_URL}/{sub}
Authorization: Bearer {ENTITLEMENTS_PULL_TOKEN}
```

Returns the payload (`200`) or `404` when the source has no record for that subject (Lodrö then
keeps whatever it has). Called on every login and whenever a person's cached entitlements are
older than 15 minutes. Timeout 8 s; failures are logged and the cache is kept.

## Push channel

```
POST {APP_URL}/api/webhooks/entitlements
Content-Type: application/json
X-Timestamp: 1757583600           # unix seconds
X-Event-Id:  6f1c…                # unique per event; duplicates are acknowledged, not reprocessed
X-Signature: hex(HMAC-SHA256(ENTITLEMENTS_WEBHOOK_SECRET, "{X-Timestamp}.{raw body}"))
```

Send it on every change (purchase, tier change, cohort placement, expiry). Lodrö:

1. rejects missing headers (`400`), a timestamp more than 5 minutes away (`401`), a bad signature (`401`);
2. stores the event (`webhook_event`, unique on `X-Event-Id`); a repeat returns `200 {"ok":true,"duplicate":true}`;
3. validates the payload against the contract (`422` on failure, the row keeps the error);
4. applies it and answers `200 {"ok":true}`.

Every event is visible at `/admin/webhooks`. Node example of the sender:

```js
const body = JSON.stringify(payload);
const ts = String(Math.floor(Date.now() / 1000));
const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
await fetch(`${APP_URL}/api/webhooks/entitlements`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-timestamp": ts,
    "x-signature": sig,
    "x-event-id": crypto.randomUUID(),
  },
  body,
});
```

## Roles and sessions

A change of `roles` deletes the person's Lodrö sessions; their next request goes through the IdP
again (silently, if they still have an IdP session) and comes back with the new privileges.

## Versioning

The `version` field is checked literally. A breaking change ships as `entitlements/v2` alongside
`v1`, with a deprecation window; additive changes (new optional fields) stay in `v1`.
