# Lodrö

A lean, self-hostable, open-source course platform. Courses made of chapters made of lessons
(text, video, audio, files, embeds, assignments, quizzes), cohorts with drip release, per-lesson
progress. Lodrö is a **relying party**: your identity provider says who someone is, your own
system says what they may access, and Lodrö delivers the lessons. It never handles sign-up,
passwords or payments.

**Stack** — TanStack Start (React 19, Router, Query, Form) on Vite · PostgreSQL 16 + Drizzle ·
OIDC via `openid-client` · S3-compatible storage · SMTP · Vimeo behind a provider interface ·
Tailwind v4 with hand-written primitives · vitest + Playwright. MIT licence.

Spec: `docs/spec.md` · Decisions: `docs/decisions/` · Visual rules: `docs/DESIGN.md` ·
Agent rules: `CLAUDE.md`.

## Run it locally

```bash
git clone https://github.com/olozano-p/sota-lms && cd lodro
cp .env.example .env
docker compose up
```

Open http://localhost:3003. You are sent to the mock identity provider on port 3013: pick one of
the four users (student, delayed-access student, teacher, admin) and you are back in the app with
a seeded course. No real IdP or credentials needed.

For development with hot reload:

```bash
pnpm install                                                # installs the git hooks too
docker compose up -d postgres minio minio-init mock-idp     # services only
pnpm db:migrate && pnpm db:seed
pnpm dev                                                    # http://localhost:3003
```

## Deploying

`docs/deploy.md` covers the official Docker image behind a reverse proxy and an rsync/nginx
alternative for a single VPS. Wiring your identity provider and entitlement source:
`docs/idp-integration.md` and `docs/entitlements-contract.md`. Vimeo: `docs/video-vimeo.md`.

## Scripts

| Command                                                   | What                                               |
| --------------------------------------------------------- | -------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                  | dev server · production build · serve `dist/`      |
| `pnpm typecheck` · `pnpm lint` · `pnpm fmt` · `pnpm test` | the gates the pre-commit hook mirrors              |
| `pnpm e2e`                                                | Playwright smoke suite against the compose stack   |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed`   | new migration from the schema · apply · demo data  |
| `pnpm mock-idp`                                           | run the development IdP + entitlement source alone |

## Contributing

See `CONTRIBUTING.md`. Security reports: `SECURITY.md`.
