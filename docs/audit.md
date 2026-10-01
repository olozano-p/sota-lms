# Audit against the implementation brief (Phase 0)

Scope: the repo at `1fee9d3` compared with the "standalone LMS + optional external provider" brief.
The code is the reference; this document records where the brief and the code disagree.

## Finding

The repo is not a skeleton. It is a working OIDC relying party (40 commits) with courses, chapters,
lessons made of blocks, cohorts with drip release, assignments, quizzes, a forum, local/S3 storage,
queued mail, i18n (ca/es/en) and a mock IdP. The brief's Phase 0–1 largely describe a different
product direction (SOTA owning identity) rather than missing pieces.

## Maps onto the brief (exists)

| Brief                                           | Repo                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| TanStack Start, TS strict, Drizzle, Postgres    | ADR-001, ADR-002                                                               |
| Course → chapter → lesson, slugs, publish/draft | `course`, `chapter`, `lesson`, `lesson_block`                                  |
| Cohorts + drip rule                             | `cohort`, `cohort_release` (per-chapter/lesson dates)                          |
| Assignments, quizzes, submissions               | `assignment`, `submission`, `quiz`, `question`, `quiz_attempt`                 |
| Progress with media position                    | `lesson_progress`                                                              |
| Storage adapter local/S3                        | `StorageProvider`, ADR-012                                                     |
| Video provider interface                        | ADR-005                                                                        |
| i18n ca/es/en                                   | `src/i18n` (typed catalogues)                                                  |
| OIDC login, entitlement mirror, webhook, pull   | ADR-003/004, `docs/entitlements-contract.md`                                   |
| Dockerfile, compose, CI, health                 | `Dockerfile`, `docker-compose*.yml`, `.github/workflows/ci.yml`, `/api/health` |
| Roles, audit log, rate limiter                  | `authz.ts`, `audit_log`, `src/start.ts`                                        |
| ADRs, CLAUDE.md                                 | `docs/decisions/` (not `docs/adr/`), `CLAUDE.md`                               |
| MIT licence                                     | ADR-006 (already decided)                                                      |

## Missing relative to the brief

- Local auth mode (`AUTH_MODE=local`), signup toggle, magic link, invites, `create-admin`, break-glass admin.
- `/api/v1` service API (enrollments PUT/DELETE, progress, courses), OpenAPI document, bearer token.
- Claims-based entitlement sync at login (the repo pulls from an entitlement URL instead).
- Theming: `theme/` directory, `theme.json`, slots, email overrides, example themes (brand is
  `lms.config.ts` + CSS tokens today).
- `sota` CLI (`migrate`, `seed`, `validate-*`), `sota export/import`, GHCR publish on tag.
- Typed env schema covering every variable (config schema exists for `lms.config.ts`; env is read ad hoc).
- Manual enrollment by email list.

## Conflicts (need a decision, not code)

1. **Auth library and account store.** ADR-003 states: "Rejected and not to be re-proposed:
   better-auth (or any auth library) inside SOTA as the account store; magic links." CLAUDE.md:
   "No sign-up, no passwords." The brief requires exactly these. Irreversible per the brief.
2. **Entitlement model** (resolved by ADR-014 and the `enrollment` migration). Brief: `enrollment(source manual|claims|webhook)`. Repo: `entitlement(scope
course|all_courses|cohort, rule, source external|admin)` with access rules in `lms.config.ts`
   and `canSeeLesson()` as the only gate. Different shape, richer in the repo (tiers, delayed access).
3. **Identity key.** Brief: `user.external_sub`; repo: `person.idp_sub NOT NULL UNIQUE`. Local users have no sub.
4. **Forum.** Brief §10 puts discussion forums out of scope; the repo ships one (ADR-011).
5. **Roles.** Brief: learner/instructor/admin on the user; repo: roles from IdP claim plus per-course teachers.
6. **ADR location and name.** `docs/adr/0001-…` vs `docs/decisions/ADR-0NN-…` ("append, never rewrite").
7. **Licence.** Brief asks for a proposal; ADR-006 already chose MIT.
8. **Config source.** Brief: env only plus `theme/`; repo: `.env` plus `lms.config.ts`.

## Deployment-specific references

A search for the reference organisation's name, domain and acronyms across the tree (excluding
`node_modules`, `.git`, `data`) found none. The repo currently meets the "nothing deployment-specific" rule.
The only default worth reviewing is `timeZone: "Europe/Madrid"` and `locales.default: "ca"` in
`lms.config.ts`, which are configuration, not code.

## Delete list

Nothing is recommended for deletion on the brief's account.
