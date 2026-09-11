# ADR-008 · Hand-written UI primitives, no component library

**Date** 2026-09-11 · **Status** accepted

## Decision

`src/components/ui` holds a small set of hand-written primitives (button, input, textarea, select,
checkbox, radio, field, card, alert, badge, dialog, tabs, progress rule, table, skeleton) built
with Tailwind v4 utilities over the tokens in `src/styles.css`, `class-variance-authority` for
variants and native elements (`<dialog>`, `<select>`, `<details>`) wherever the browser already
does the work.

## Why

- The visual identity (`docs/DESIGN.md`) is deliberately not the generic component-library look;
  owning fifteen small files is cheaper than fighting a library's defaults.
- Native elements bring focus management, Escape, the top layer and accessibility for free; a
  headless library would re-implement them at a cost in bundle and behaviour drift.

## Consequences

- Rejected: shadcn/ui, Radix, Base UI, Headless UI, MUI. The spec named shadcn; this supersedes it.
- Anything not covered (a combobox, a date picker) is added as a primitive when the third caller
  appears, not before.
