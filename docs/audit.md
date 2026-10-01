# Audit against the implementation brief

Written in Phase 0 (the repo at `1fee9d3` compared with the "standalone LMS + optional external
provider" brief), closed in Phase 5 for version 1.0.0. The code is the reference; this document
records where the brief and the code differed and how each difference ended.

**Final state: every item below is resolved or a deliberate deviation. Nothing is open.**

## Finding (Phase 0)

The repo was not a skeleton. It was a working OIDC relying party (40 commits) with courses, chapters,
lessons made of blocks, cohorts with drip release, assignments, quizzes, a forum, local/S3 storage,
queued mail, i18n (ca/es/en) and a mock IdP. The brief's Phase 0–1 largely described a different
product direction (SOTA owning identity) rather than missing pieces.

## Maps onto the brief

| Brief                                           | Repo                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| TanStack Start, TS strict, Drizzle, Postgres    | ADR-001, ADR-002                                                                                         |
| Course → chapter → lesson, slugs, publish/draft | `course`, `chapter`, `lesson`, `lesson_block`                                                            |
| Cohorts + drip rule                             | `cohort`, `cohort_release` (per-chapter/lesson dates), the generated "N chapters every D days" (ADR-018) |
| Assignments, quizzes, submissions               | `assignment`, `submission`, `quiz`, `question`, `quiz_attempt`                                           |
| Progress with media position                    | `lesson_progress`                                                                                        |
| Storage adapter local/S3                        | `StorageProvider`, ADR-012                                                                               |
| Video provider interface                        | ADR-005                                                                                                  |
| i18n ca/es/en                                   | `src/i18n` (typed catalogues)                                                                            |
| Auth: local accounts and OIDC                   | ADR-013, ADR-016, ADR-017; better-auth; `AUTH_MODE`                                                      |
| Enrollment sources manual / claims / webhook    | ADR-014, ADR-018; `access/claims.ts`, `access/enrollments.ts`, `mutations/enrollments*.ts`               |
| Service API with OpenAPI                        | ADR-020; `src/server/api/v1/`, `/api/v1/openapi.json`                                                    |
| Theming                                         | ADR-019; `THEME_DIR`, `pnpm sota validate-theme`                                                         |
| `sota export` / `sota import`                   | ADR-021; `scripts/content.ts`, `docs/content-export-import.md`                                           |
| Dockerfile, compose, CI, health                 | `Dockerfile`, `compose.yml` (production), `compose.dev.yml`, `.github/workflows/`, `/api/health`         |
| GHCR publish on tag                             | `.github/workflows/release.yml`                                                                          |
| Roles, audit log, rate limiter                  | `authz.ts`, `audit_log` (every enrollment write, `docs/audit-log.md`), `src/server/security.ts`          |
| Structured logs, health with DB check           | `src/lib/log.ts`, `src/server/request-log.ts`, `docs/observability.md`                                   |
| Backup and restore                              | `docs/backup-restore.md` (drill run against a scratch database)                                          |
| ADRs, CLAUDE.md                                 | `docs/decisions/` (not `docs/adr/`), `CLAUDE.md`                                                         |
| MIT licence                                     | ADR-006 (already decided)                                                                                |

## Missing relative to the brief (Phase 0): all done

- ~~`/api/v1` service API, OpenAPI document, bearer token~~ (Phase 4, ADR-020).
- ~~Theming~~ (Phase 3, ADR-019).
- ~~`sota export/import`~~ (Phase 5, ADR-021). ~~GHCR publish on tag~~ (Phase 5). The `sota` CLI also has
  `migrate`, `seed`, `create-admin`, `validate-config`, `validate-theme`.
- ~~Rate limiting verified, per-address mail throttle~~ (Phase 5: `verify-password`, the legacy webhook
  and server functions were uncovered; account mail is limited to five an hour per address).
- ~~Audit of enrollment changes~~ (Phase 5: the pull, the webhook and the claims sync wrote none or only
  counts; every path now records per-row before/after).
- ~~Logs, health with a DB check, backup guide, release pipeline, 1.0.0 documentation~~ (Phase 5).

## Conflicts (Phase 0) and how they ended

1. **Auth library and account store.** ADR-003 had rejected "better-auth (or any auth library) inside SOTA as
   the account store; magic links", and CLAUDE.md said "No sign-up, no passwords". The brief required exactly
   these. Resolved by ADR-013, ADR-016, ADR-017: both modes exist, `AUTH_MODE` picks one, the OIDC mode keeps
   the relying-party guarantees.
2. **Entitlement model.** Brief: `enrollment(source manual|claims|webhook)`. Repo: `entitlement(scope, rule,
source)` with access rules in `lms.config.ts`. Resolved by ADR-014: `enrollment` replaced it, tiers and
   delayed-access rules left the repository.
3. **Identity key.** Resolved by ADR-016: nullable `external_sub` + `external_iss` on `person`.
4. **Forum.** The brief puts discussion forums out of scope; the repo ships one (ADR-011).
   **Deliberate deviation**, kept (ADR-015): removing a working, tested feature helps nobody.
5. **Roles.** Resolved by ADR-016: `student/teacher/admin` with the brief's `learner/instructor/admin`
   accepted as aliases, plus per-course teachers.
6. **ADR location and name.** The brief says `docs/adr/0001-…`; the repo uses `docs/decisions/ADR-0NN-…`
   ("append, never rewrite"). **Deliberate deviation**, kept; the decision README explains the shape.
7. **Licence.** The brief asks for a proposal; ADR-006 had already chosen MIT. **Deliberate deviation** (a
   decision already taken).
8. **Config source.** Brief: environment only plus `theme/`. Repo: `.env`, `lms.config.ts` (locales, time zone,
   upload limits, notification defaults) and the theme directory. **Deliberate deviation**, kept (ADR-015):
   brand, colours and language moved to the theme in Phase 3; what stays in `lms.config.ts` is typed and
   validated, and does not name an organisation.

## Other deliberate deviations recorded along the way

- **Content bundle is a directory, not a tar or zip** (ADR-021): no dependency, and any tool packs it.
- **Quizzes do not grade or gate** (ADR-018): `form` and `self_check` kinds; `pass_threshold` is informational.
- **The service API writes `webhook` rows** instead of a new source (ADR-020): one reconciler, one `external_id`
  key; the complete-set channels and the API must not serve the same people.
- **One HMAC secret, `WEBHOOK_HMAC_SECRET`**, with `ENTITLEMENTS_WEBHOOK_SECRET` as a deprecated alias (ADR-020).
  The alias has no removal date; remove it in a later major version.
- **Enrollment audit lists the first 100 changes of a bulk write** and counts the rest (`docs/audit-log.md`).
- **Health keeps `db: "ok"` and adds `version` and `dbLatencyMs`** instead of nesting the database status,
  so existing probes that read the old shape keep working.
- **`pnpm sota import` has no web UI and no session**: the operator's shell is the credential (ADR-021).

## Deployment-specific references

A search for the reference organisation's name, domain and acronyms across the tree (excluding
`node_modules`, `.git`, `data`) finds none; `tests/repo-hygiene.test.ts` now fails if one appears. The only
defaults worth reviewing are `timeZone: "Europe/Madrid"` in `lms.config.ts` and the default locale in the
theme, which are configuration, not code.

## Delete list

Nothing is recommended for deletion on the brief's account.
