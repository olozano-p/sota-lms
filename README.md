# SOTA

A lean, self-hostable, open-source course platform. Courses made of chapters made of lessons
(text, video, audio, files, embeds, assignments, quizzes), cohorts with drip release, per-lesson
progress. SOTA is a **relying party**: your identity provider says who someone is, your own
system says what they may access, and SOTA delivers the lessons. It never handles sign-up,
passwords or payments.

The name is the Pali [_sotāpanna_](https://en.wikipedia.org/wiki/Sot%C4%81panna), "the one who
has entered the stream": the moment a path stops being an idea and becomes the direction you are
already moving in. SOTA wants to be that first step for the people who learn with it, and to get
out of the way once they are moving.

<p align="center">
  <img src="docs/screenshots/syllabus.png" alt="Course page: syllabus rail with lesson states, progress rule and a single Continue button" width="800">
</p>

**Stack** — TanStack Start (React 19, Router, Query, Form) on Vite · PostgreSQL 16 + Drizzle ·
OIDC via `openid-client` · files on disk or any S3 API · SMTP · Vimeo behind a provider interface ·
Tailwind v4 with hand-written primitives · vitest + Playwright. MIT licence.

Spec: `docs/spec.md` · Decisions: `docs/decisions/` · Visual rules: `docs/DESIGN.md` ·
Agent rules: `CLAUDE.md`.

## What it does

- **Courses → chapters → lessons**, each lesson a stack of blocks: rich text (edited in place,
  stored as Markdown, with images and YouTube/Vimeo players), video (Vimeo), audio, files,
  allow-listed embeds, an assignment or a quiz.
- **Access decided by one pure function** from the entitlements your system pushes or the LMS
  pulls, the course and lesson publish state, and the cohort's release schedule. Locked lessons
  say why and when.
- **Cohorts** with drip release by chapter or lesson, automatic placement from a `cohort`
  entitlement, and a member page with the calendar.
- **Assignments** (text and/or file, resubmission, teacher review with feedback) and **quizzes
  or forms** (four question types, auto-grading, optional pass mark, results per option).
- **Progress** per lesson, media resume, "continue where you left off".
- **Teacher editor** with drag-sort, autosave, streamed uploads with progress, Vimeo lookup.
- **Forums**: one per course (teachers switch it on) and a general one. Threads pinned-first then
  by latest reply, quoting, like/dislike, moderation by the course's teachers.
- **Admin** area: people, entitlements with local grants, webhook log, audit log.
- **Notifications** by email: feedback at once, the rest in a daily digest.
- **Three locales** shipped (ca, es, en); dark theme; keyboard navigation in the player.

| Lesson player                                 | Editor                                        |
| --------------------------------------------- | --------------------------------------------- |
| ![Lesson player](docs/screenshots/lesson.png) | ![Course editor](docs/screenshots/editor.png) |

## Run it locally

```bash
git clone https://github.com/olozano-p/sota-lms && cd sota-lms
cp .env.example .env
docker compose up
```

Open http://localhost:3003. You are sent to the mock identity provider on port 3013: pick one of
the four users (student, delayed-access student, teacher, admin) and you are back in the app with
a seeded course. No real IdP or credentials needed.

For development with hot reload:

```bash
pnpm install                                                # installs the git hooks too
docker compose up -d postgres mock-idp                      # services only
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
