# Enrollment contract — `enrollments/v1`

(The file name and the `ENTITLEMENTS_PULL_*` variables predate ADR-014 and stay so existing deployments
keep working; the model behind them is `enrollment`. The push secret is `WEBHOOK_HMAC_SECRET`;
`ENTITLEMENTS_WEBHOOK_SECRET` is a deprecated alias, ADR-020. To enroll one person at a time instead of
sending complete sets, use the service API: `docs/integration.md`. Do not combine both for the same
people: a complete-set payload revokes the `webhook` rows it does not list.)

SOTA never decides _who may access what_ on its own. An external **enrollment source** (usually
the system that also runs your identity provider, but not necessarily) tells it, through a small
versioned JSON contract with two channels. The mock in `dev/mock-idp/` implements both. A
deployment that runs SOTA alone needs neither: admins create `manual` enrollments.

## Payload

```json
{
  "version": "enrollments/v1",
  "sub": "idp-user-id",
  "email": "x@y.z",
  "name": "Full Name",
  "locale": "ca",
  "roles": ["student"],
  "enrollments": [
    {
      "external_id": "ord-1042-line-1",
      "course": "course-slug",
      "cohort": null,
      "valid_from": "2026-09-01T00:00:00Z",
      "valid_until": "2027-01-31T23:00:00Z",
      "status": "active"
    },
    { "external_id": "ord-1042-line-2", "course": "other-course", "cohort": "cohort-slug" }
  ]
}
```

| Field                       | Meaning                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sub`                       | The OIDC subject (`person.external_sub`). The join key between the IdP and the enrollment source. A person already known by the same email adopts it.                                                    |
| `email`, `name`             | Mirrored into `person`. SOTA never edits them.                                                                                                                                                           |
| `locale`                    | Optional; one of the enabled locales. Used when the ID token carries no `locale` claim.                                                                                                                  |
| `roles`                     | `student`, `teacher`, `admin` (`learner`, `instructor` accepted as aliases). The IdP's roles claim wins right after login; the source's win on later syncs. A person adopted by email keeps their roles. |
| `enrollments[].external_id` | The source's own id for this enrollment. Unique among `webhook` rows; the reconciliation key.                                                                                                            |
| `enrollments[].course`      | Course slug or the course's `external_ref`. Unknown references are logged and skipped.                                                                                                                   |
| `enrollments[].cohort`      | Optional cohort slug or `external_ref` (must belong to `course`). Also places the person in that cohort as a student.                                                                                    |
| `enrollments[].valid_from`  | ISO 8601 instant with offset; default is the time of the first sync; a later sync without it keeps the stored start.                                                                                     |
| `enrollments[].valid_until` | ISO 8601 instant with offset, **exclusive**; `null` or absent means open-ended.                                                                                                                          |
| `enrollments[].status`      | `active` (default), `expired` or `revoked`.                                                                                                                                                              |

Each payload is the **complete** set of enrollments the source holds for that person. SOTA
reconciles its `source = 'webhook'` rows with it by `external_id`: listed rows are inserted or
updated, rows no longer listed are marked `revoked` (kept for the history). Enrollments an admin
created in SOTA (`source = 'manual'`) and rows read from the ID token (`source = 'claims'`, below) are never created, changed or deleted by the contract.

## Claims channel (OIDC mode)

When `ENTITLEMENT_CLAIM` is set, the ID token may carry the enrollments itself: an array of
`{course, cohort?, until?}` (`course` and `cohort` by slug or `external_ref`, `until` an exclusive ISO 8601
instant). Each sign-in reconciles the person's `source = 'claims'` rows with it: unknown references are
logged and ignored, rows no longer listed become `expired`, a malformed claim changes nothing. It is
independent of the pull/webhook channel; both may be active.

SOTA does not expand tiers or decide what a membership includes: the source sends one enrollment per
course (and cohort) with the `valid_until` it wants. There is no "all courses" scope and no rule
configuration in `lms.config.ts`.

## Access

A person may open a course when any of their enrollments for it is `active` and `now` lies within
`valid_from` .. `valid_until`. Several enrollments may match; one live row is enough. When the
person belongs to a cohort of the course, the cohort's drip schedule (`cohort_release`) decides when
each chapter or lesson opens, never earlier than the enrollment does. Teachers of the course and
admins see everything. Locked lessons show why: not enrolled, expired, or not yet released.

## Pull channel

```
GET {ENTITLEMENTS_PULL_URL}/{sub}
Authorization: Bearer {ENTITLEMENTS_PULL_TOKEN}
```

Returns the payload (`200`) or `404` when the source has no record for that subject (SOTA then
keeps whatever it has). Called on every login and whenever a person's cached enrollments are
older than 15 minutes. Timeout 8 s; failures are logged and the cache is kept.

## Push channel

```
POST {APP_URL}/api/webhooks/entitlements
Content-Type: application/json
X-Timestamp: 1757583600           # unix seconds
X-Event-Id:  6f1c…                # unique per event; duplicates are acknowledged, not reprocessed
X-Signature: hex(HMAC-SHA256(WEBHOOK_HMAC_SECRET, "{X-Timestamp}.{raw body}"))
```

Send it on every change (purchase, renewal, cohort placement, expiry, refund). SOTA:

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

A change of `roles` deletes the person's SOTA sessions; their next request goes through the IdP
again (silently, if they still have an IdP session) and comes back with the new privileges.

## Versioning

`enrollments/v1` replaces `entitlements/v1` (ADR-014); a source still sending the old payload gets `422`. The `version` field is checked literally. A breaking change ships as `enrollments/v2` alongside
`v1`, with a deprecation window; additive changes (new optional fields) stay in `v1`.
