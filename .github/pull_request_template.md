## What and why

<!-- One or two sentences. Link the issue this closes, if any. -->

## How it was checked

<!-- The flow you exercised at http://localhost:3003, and in which AUTH_MODE. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm test` pass locally
- [ ] Writes go through `src/server/mutations/*`, are guarded and append an `audit_log` row
- [ ] New user-facing text is in `ca.ts`, `es.ts` and `en.ts`; no hex or raw palette colours
- [ ] Schema changes come with a generated migration; no applied migration was edited
- [ ] Nothing organisation-specific in `src/`; docs updated where behaviour changed
