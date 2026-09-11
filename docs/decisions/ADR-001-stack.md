# ADR-001 · TanStack Start on Vite, one process, one repo

**Date** 2026-09-11 · **Status** accepted

## Decision

Lodrö is a single TanStack Start app (React 19, TanStack Router + Query + Form + Table, Vite 8,
TypeScript strict, pnpm). Server functions and file-based API routes are the whole backend; the
production server is `scripts/serve.mjs`, a `node:http` bridge to the fetch handler Vite emits,
packaged in the official Docker image. Lint and format with oxlint/oxfmt, unit tests with vitest,
smoke tests with Playwright. Node 24 in the image; `engines` allows ≥ 22.

## Why

- One stack for routing, data loading, server functions and forms; the team already runs two
  apps on it, so conventions and gotchas carry over (see `CLAUDE.md` § Gotchas).
- The app is small by design (one organisation per deployment): a separate API service or a
  worker would be infrastructure looking for a problem.
- Vite gives fast HMR and a build we can serve with sixty lines of Node, which keeps the Docker
  image and the rsync alternative equally simple.

## Consequences

- Rejected and not to be re-proposed: Next.js (RSC churn buys nothing here), a separate
  Express/Hono API, Remix, SvelteKit, Deno or Bun as runtime, Frappe (the model was borrowed, the
  framework was not).
- TanStack Start renames APIs between minors (`server.handlers`, `.validator`); minors are pinned
  in `package.json` and traps recorded in `CLAUDE.md`.
