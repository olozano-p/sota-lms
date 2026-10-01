# Enrollment audit trail

Every write to an `enrollment` row appends an `audit_log` row in the same transaction, whoever or
whatever made it. `diff` is `{ actor?, before, after }`; the actor is the person (`actor_person_id`) or,
for the sync paths, a label in `diff.actor`.

| Path                                               | `action`                                              | Actor                | Entity     | `after`                                                      |
| -------------------------------------------------- | ----------------------------------------------------- | -------------------- | ---------- | ------------------------------------------------------------ |
| Complete-set sync, push (`POST /api/webhooks/...`) | `enrollment.sync`                                     | `sync:webhook`       | person     | changes list, `channel: "webhook"`                           |
| Complete-set sync, pull (login, TTL, admin resync) | `enrollment.sync`                                     | `sync:pull`          | person     | changes list, `channel: "pull"`                              |
| ID-token claims at sign-in                         | `enrollment.claims_sync`                              | `sync:claims`        | person     | counts and changes list                                      |
| Service API `PUT` / `DELETE /enrollments/{id}`     | `enrollment.service_put`, `enrollment.service_revoke` | `service:api`        | enrollment | `before` and `after` snapshots                               |
| Manual grant / revoke (admin)                      | `enrollment.grant`, `enrollment.revoke`               | the admin            | enrollment | `before` and `after` rows                                    |
| Pasted list (course Enrollments tab, cohort page)  | `enrollment.bulk`                                     | the teacher or admin | course     | outcome counts and changes list, one entry per address       |
| Enroll a whole cohort in a course                  | `enrollment.cohort`                                   | the teacher or admin | cohort     | changes list                                                 |
| Cohort placement / removal                         | `cohort.member.add`, `cohort.member.remove`           | the teacher or admin | cohort     | the enrollment's change (`add`), the revoked rows (`remove`) |
| Cohort deletion (cascades to its enrollments)      | `cohort.delete`                                       | the teacher or admin | cohort     | the deleted rows                                             |
| A sub-keyed placeholder merged at sign-in          | `person.adopt_placeholder`                            | `oidc-login`         | person     | moved and dropped rows                                       |
| Demo seed                                          | `enrollment.seed`                                     | `seed`               | person     | replaced and created rows                                    |

A **change** is `{ enrollmentId, op, before, after, note? }`: `op` is `created`, `updated`, `revoked`,
`expired`, `deleted`, `moved` or `unchanged`; `before` and `after` are snapshots (`personId`, `courseId`,
`cohortId`, `source`, `externalId`, `status`, `validFrom`, `validUntil`), null on the side that does not
exist. A single change has its own audit row. Anything that touches many rows (sync of many enrollments,
a pasted list, a cohort) keeps one audit row with the first 100 changes (`AUDIT_DETAIL_CAP`) plus
`total` and `truncated`; a list of 500 addresses says so and lists 100.

A sync that changes nothing writes nothing: the same pull or webhook every 15 minutes does not fill the log.
