# Contributing to SOTA

Thank you for considering a contribution. SOTA is small on purpose: a lean LMS that leaves
identity and payments to other systems. Contributions that keep it lean are the ones most likely
to land.

## Before you start

- Read `README.md`, then `docs/spec.md` (what the product is and is not) and the decisions in
  `docs/decisions/` (why it is built the way it is). A rejected alternative recorded in an ADR is
  not re-proposed in a PR; open a discussion first if you think the ground has shifted.
- Open an issue for anything beyond a small fix, so we can agree on the shape before the work.
- Nothing organisation-specific may enter `src/`: names, membership tiers, domains, brand. If a
  second organisation forking the repo tomorrow would have to edit a `.ts` file to run it, the
  change belongs in `lms.config.ts`, `.env` or the database.

## Local setup

```bash
pnpm install                      # installs the git hooks too
cp .env.example .env              # the defaults point at the docker stack below
docker compose up -d postgres minio minio-init mock-idp
pnpm db:migrate && pnpm db:seed
pnpm dev                          # http://localhost:3003 — sign in as one of the three mock users
```

Or `docker compose up` for everything, app included.

## Working on a change

- One branch per change, from `main`. Keep PRs focused: one feature or one fix.
- Every write goes through `src/server/mutations/*` and is authorised there; access to content is
  decided only by `canSeeLesson()` in `src/server/access/rules.ts`. See `CLAUDE.md` for the full
  list of invariants — they are the review checklist.
- User-facing text goes through the i18n catalogs (`src/i18n/ca.ts` is the source; `es.ts` and
  `en.ts` must carry every key — the type checker enforces it).
- Colours, radii and type come from the tokens in `src/styles.css` (`docs/DESIGN.md`). No raw
  Tailwind palette utilities, no hex values in components.
- Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, read the SQL, commit it. Never
  edit a migration that has shipped.
- Run the gates before pushing: `pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm test`.
  The pre-commit hook runs them on staged files; CI runs them on everything plus a migration
  dry-run and the Playwright smoke suite.

## Commits

One line: a gitmoji, a space, a capitalised English subject — `✨ Add drip release to cohorts`.
Two or three lines only when the _why_ needs stating. The `commit-msg` hook checks the shape.

## Adding a rule type, a video provider or a locale

- **Access rule type**: implement it in `src/server/access/rules.ts` behind the existing
  `AccessRule` union, add its rows to the matrix in `tests/access.test.ts`, document it in
  `docs/entitlements-contract.md`.
- **Video provider**: implement `VideoProvider` from `src/server/services/video/provider.ts`, register
  it in `src/server/services/video/index.ts`, add a `docs/video-<name>.md`.
- **Locale**: add `src/i18n/<code>.ts` typed `Record<MessageKey, string>`, register it in
  `src/i18n/locale.ts`, and enable it in `lms.config.ts`.

## Reporting security issues

Please do not open a public issue. See `SECURITY.md`.
