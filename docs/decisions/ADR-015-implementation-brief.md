# ADR-015 · The implementation brief is the target; where this repo differs on purpose

**Date** 2026-10-01 · **Status** accepted

## Decision

The standalone-LMS brief is the target architecture (see `docs/audit.md` for the gap list). Three
deliberate deviations:

- **The forum stays** (ADR-011). The brief lists forums as out of scope; the maintainer overrode it.
- **ADRs live in `docs/decisions/`** with the `ADR-NNN-` prefix, not `docs/adr/`.
- **MIT stays** (ADR-006); the brief's licence proposal is moot.

`lms.config.ts` is kept for structured non-secret config until theming lands (Phase 3), when brand
moves to `theme/theme.json`; environment variables remain the single place for secrets.

## Consequences

Work proceeds phase by phase. Each phase ends with checks green, a `docs/status.md` entry and
`CLAUDE.md` updated to match the code.
