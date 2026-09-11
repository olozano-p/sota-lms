# Lodrö — a lean LMS that relies on your identity provider

Courses → chapters → lessons made of blocks (text, video, audio, file, embed, assignment, quiz);
cohorts with drip release; progress per lesson. Lodrö is an **OIDC relying party**: identity comes
from an external IdP and access from an external _entitlement source_ over a versioned JSON
contract. It never sells, registers or authenticates anyone. Product spec: `docs/spec.md`.
Decisions: `docs/decisions/` (append, never rewrite). Visual rules: `docs/DESIGN.md`. When a
document and the code disagree, the code is right and the document gets fixed.

## Load-bearing invariants

- **Every write goes through `src/server/mutations/*`**, starting with `requireUser()` /
  `requireRole()` / `requireCourseTeacher()` from `src/server/auth/authz.ts`, and appends an
  `audit_log` row (the one exception is a person's own `lesson_progress`, written every ~10 s of
  playback). Loaders, queries and components never write.
- **Identity is mirrored, never owned.** `person` and `entitlement` rows with `source = 'external'`
  are written only by the OIDC callback, `syncEntitlements()` and the webhook handler. No sign-up,
  no passwords, no role UI. Admin grants are `source = 'admin'` and never overwrite external rows.
- **Access is one pure function**: `canSeeLesson()` in `src/server/access/rules.ts` takes the
  entitlements, the course/lesson state, the cohort releases and `now` as data. Content loaders
  call `requireLessonAccess()`, which calls it. Nothing else decides who sees what.
- **Generic core, configured edge.** Organisation names, tiers, domains, brand, IdP details live in
  `.env`, `lms.config.ts` or the database. Test: would a second organisation have to edit a `.ts`
  file to run their fork? Then it is misplaced. Lock reasons are i18n'd from the rule _type_.
- **Files are private.** Only `/api/files/$fileId` hands out signed URLs (≤ 5 min) after an access check.
- **Assignments and quizzes are reached through the lesson block that embeds them**:
  `requireContainerAccess()` in `src/server/access/container.ts` is the only gate.
- **Mail is queued, never sent inline**: mutations `enqueue()`; `scripts/notify.ts` (the tick, run by
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
no `drizzle-kit push`, no editing applied migrations. No Next.js, no RSC. No stored "unlocked"
flags: visibility is computed. No raw Tailwind palette colours or hex in components — tokens only.
No telemetry. No org-specific code.

## Commands

```bash
docker compose up -d postgres minio minio-init mock-idp   # dev services (5433, 9010/9011, 3013)
pnpm db:migrate && pnpm db:seed   # migrations + demo course, cohort, three mock users
pnpm dev                          # http://localhost:3003
pnpm typecheck · pnpm lint · pnpm fmt · pnpm test · pnpm e2e
pnpm db:generate                  # new migration after editing src/db/schema.ts
pnpm notify                       # one notification tick (FORCE_DIGEST=true to send the digest now)
```

## Layout

```
src/routes/            file routes; _authed = session, _authed/teach = teacher, _authed/admin = admin; api/ = handlers
src/server/auth/       oidc.ts · session.ts (client-safe getSession) · authz.ts (server-only guards)
src/server/access/     rules.ts (pure) · entitlements.ts (pull, cache, webhook) · require.ts
src/server/queries/ mutations/ services/   reads · writes+audit · video/, files, email/
src/db/  src/lib/  src/i18n/  src/components/{ui,shell,syllabus,player,editor}  src/config/
dev/mock-idp/          oidc-provider + mock entitlement source     drizzle/  tests/  docs/
```

## Gotchas

- API routes: `createFileRoute("/api/x")({ server: { handlers: { GET, POST } } })`. Server functions
  use `.validator(zodSchema)`; read the request with `getRequest()` from `@tanstack/react-start/server`.
  The root `beforeLoad` also runs on the client, so it calls the `getSession` server fn.
- `src/db/*`, `src/config/*`, `src/server/services/{notifications,email}` and `scripts/*` run under Node's native TypeScript: relative imports
  with `.ts` extensions, no `~/` alias, no `enum`, no parameter properties.
- `DATABASE_URL=pglite://memory` opens an in-memory PGlite (tests); anything else is `pg`.
- Server-only modules (`authz.ts`, `oidc.ts`, `src/db`, services) are imported only from server
  handlers; `src/server/auth/session.ts` is the client-safe surface.
- Handlers that set cookies must return `new Response(null, { status, headers: { location } })`, never
  `Response.redirect()`: its headers are immutable and the framework cannot append `Set-Cookie`.
- `vite dev` loads `.env` once at start; a new variable needs a restart. So does `src/start.ts`
  (the request middleware: CSP nonce, security headers, rate limiter).
- `src/routeTree.gen.ts` is generated and git-ignored: run `pnpm dev` or `pnpm build` once before `pnpm typecheck`.
