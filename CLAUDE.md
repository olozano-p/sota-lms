# SOTA — a lean LMS that works alone or relies on your identity provider

Courses → chapters → lessons made of blocks (text, video, audio, file, embed, assignment, quiz);
cohorts with drip release; progress per lesson. `AUTH_MODE` picks who owns identity: `local`
(better-auth accounts: email + password, magic link, admin invitations) or `oidc` (SOTA is an
**OIDC relying party**; people and roles come from the IdP, no local registration). Access comes
from `enrollment` rows: created by admins, read from an ID-token claim, or synced from an external
_enrollment source_ over a versioned JSON contract. It never sells anything. Product spec: `docs/spec.md`.
Decisions: `docs/decisions/` (append, never rewrite). Visual rules: `docs/DESIGN.md`. When a
document and the code disagree, the code is right and the document gets fixed.

## Direction (in progress)

Two auth modes (`AUTH_MODE=local|oidc`, ADR-013, ADR-016, ADR-017) and the `enrollment` table
(ADR-014) are done; the forum stays (ADR-015). Gap list: `docs/audit.md`; progress:
`docs/status.md`. The invariants below describe the code as it is today and are rewritten per phase.

## Load-bearing invariants

- **Every write goes through `src/server/mutations/*`**, starting with `requireUser()` /
  `requireRole()` / `requireCourseTeacher()` from `src/server/auth/authz.ts`, and appends an
  `audit_log` row (the one exception is a person's own `lesson_progress`, written every ~10 s of
  playback). Loaders, queries and components never write.
- **Identity has few writers.** `person` is also the better-auth user (ADR-016); `person.roles` is
  `student | teacher | admin`, read live on every request. It is written only by better-auth (signup,
  magic link, OIDC sign-in and its after-callback hook, `completeOidcLogin`), the admin invitation and
  role mutations (`mutations/people.ts`), `pnpm create-admin`, and `applyEnrollmentPayload` (pull and
  webhook). In `oidc` mode people and roles are the IdP's and are overwritten at every sign-in; no local
  login, signup, magic link or invitation exists except the optional break-glass admin. In `local` mode
  signup follows `ALLOW_SIGNUP` and the first admin comes from `pnpm create-admin` (ADR-017). Sessions are
  better-auth's (`getAuth()` in `src/server/auth/auth.ts`); guards in `authz.ts` stay the only entry for
  mutations. Enrollment rows with `source = 'claims'` (ID-token claim, `access/claims.ts`) or
  `'webhook'` (`access/enrollments.ts`) are written only there, reconciled idempotently; admin
  enrollments are `source = 'manual'` and no sync ever creates, changes or deletes them.
- **Access is one pure function**: `canSeeLesson()` in `src/server/access/rules.ts` takes the
  enrollments, the course/lesson state, the cohort releases and `now` as data. Content loaders
  call `requireLessonAccess()`, which calls it. Nothing else decides who sees what.
- **Generic core, configured edge.** Organisation names, tiers, domains, brand, IdP details live in
  `.env` (every variable parsed and documented: `src/config/env.ts`, `docs/configuration.md`),
  `lms.config.ts` or the database. Test: would a second organisation have to edit a `.ts`
  file to run their fork? Then it is misplaced. Lock reasons are i18n'd from the rule _type_.
- **Files are private.** Only `/api/files/$fileId` hands out signed GET URLs (≤ 5 min) after an
  access check. Storage sits behind `StorageProvider` (`src/server/services/storage`): `local`
  (default, a directory served through `/api/storage/$token`, which only honours tokens) or `s3`.
- **Assignments and quizzes are reached through the lesson block that embeds them**:
  `requireContainerAccess()` in `src/server/access/container.ts` is the only gate.
- **Mail is queued, never sent inline**: mutations `enqueue()` (account mail: `enqueueAccountMail()`,
  flushed at once because a link is useless 15 minutes later); `scripts/notify.ts` (the tick, run by
  `scripts/serve.mjs` or cron) sends immediate items and the daily digest.
- **Locale resolution order is fixed**: `?lang` → cookie → IdP `locale` claim → `Accept-Language` → config default.

## Hard rules

- **Commits are gitmoji one-liners in English** — `✨ Add drip release to cohorts`; two or three
  lines only when the why needs stating. No `Co-Authored-By`, no tool attribution. Never push.
- Optimise without over-engineering: a query, a constraint or a server function beats a new
  layer. Extract at the third caller. Do not add features beyond the task.
- Comments document functionality or constraints, never change history.
- "It compiles" is not "it works": `pnpm typecheck && pnpm lint && pnpm test`, then exercise the
  flow at http://localhost:3003 through the mock IdP before declaring done.
- Ask before deleting data, editing an applied migration or touching a docker volume.

## Language convention

Developer-facing → English (identifiers, comments, commits, docs). User-facing → i18n: `src/i18n/ca.ts`
is the source catalog and exports `MessageKey`; `es.ts` and `en.ts` are `Record<MessageKey, string>`,
so a missing key is a type error. Route paths and search params are English.

## What we do NOT do

No component library (shadcn, Radix) — hand-written primitives in `src/components/ui`. No Prisma,
no `drizzle-kit push`, no editing applied migrations. No SAML, no student API keys. No Next.js, no RSC. No stored "unlocked"
flags: visibility is computed. No raw Tailwind palette colours or hex in components — tokens only.
No telemetry. No org-specific code.

## Commands

```bash
docker compose -f compose.dev.yml up -d postgres mock-idp   # dev services (5433, 3013); files go to data/uploads
pnpm db:migrate && pnpm db:seed   # migrations + demo course, cohort, three mock users
pnpm create-admin                 # first admin (local mode) or the break-glass account (oidc mode)
AUTH_MODE=oidc pnpm dev           # sign in through the mock IdP (default AUTH_MODE is local)
pnpm dev                          # http://localhost:3003
pnpm typecheck · pnpm lint · pnpm fmt · pnpm test · pnpm e2e
pnpm db:generate                  # new migration after editing src/db/schema.ts
pnpm notify                       # one notification tick (FORCE_DIGEST=true to send the digest now)
```

## Layout

```
src/routes/            file routes; _authed = session, _authed/teach = teacher, _authed/admin = admin; api/ = handlers
src/server/auth/       auth.ts (better-auth, both modes) · identity.ts · flows.ts · session.ts (client-safe getSession) · authz.ts (server-only guards)
src/server/access/     rules.ts (pure) · enrollments.ts (pull, cache, webhook) · require.ts · forum.ts (course/general forum gate)
src/server/queries/ mutations/ services/   reads · writes+audit · video/, storage/, email/
src/db/  src/lib/  src/i18n/  src/components/{ui,shell,syllabus,player,editor,forum}  src/config/
dev/mock-idp/          oidc-provider + mock enrollment source     drizzle/  tests/  docs/
```

## Gotchas

- API routes: `createFileRoute("/api/x")({ server: { handlers: { GET, POST } } })`. better-auth is mounted at `/api/auth/*` (callback `/api/auth/callback/oidc`). Server functions
  use `.validator(zodSchema)`; read the request with `getRequest()` from `@tanstack/react-start/server`.
  The root `beforeLoad` also runs on the client, so it calls the `getSession` server fn.
- `src/db/*`, `src/config/*`, `src/server/{audit.ts,auth/{auth,accounts,flows,identity,invitations,invite-plugin,roles}.ts,access/{claims,enrollments,refs}.ts}`,
  `src/server/services/{notifications,email,storage}` and `scripts/*` run under Node's native TypeScript (the create-admin script and the sign-in hooks import them): relative imports
  with `.ts` extensions, no `~/` alias, no `enum`, no parameter properties.
- `DATABASE_URL=pglite://memory` opens an in-memory PGlite (tests); anything else is `pg`.
- Server-only modules (`authz.ts`, `oidc.ts`, `src/db`, services) are imported only from server
  handlers; `src/server/auth/session.ts` is the client-safe surface.
- Handlers that set cookies must return `new Response(null, { status, headers: { location } })`, never
  `Response.redirect()`: its headers are immutable and the framework cannot append `Set-Cookie`.
- `vite dev` loads `.env` once at start; a new variable needs a restart. So does `src/start.ts`
  (the request middleware: CSP nonce, security headers, rate limiter).
- `src/routeTree.gen.ts` is generated and git-ignored: run `pnpm dev` or `pnpm build` once before `pnpm typecheck`.
- Rich text is edited in place (Tiptap, `RichTextField`) but **stored as Markdown**; the field emits
  Markdown and `renderMarkdown()` stays the one sanitiser. A YouTube/Vimeo URL alone on its line is a
  player. `forum` is a reserved lesson slug (the course forum lives under it).
