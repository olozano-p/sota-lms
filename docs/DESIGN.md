# Lodrö — visual rules

Lodrö is a place to read, watch and think. The interface should feel like good paper: warm, quiet,
legible, with one restrained accent and nothing that shouts. Light is the default (lessons are
read); dark is a stored preference. Depth comes from hairlines and spacing, not shadows. The tokens
in `src/styles.css` are the only source of colour, radius, type and easing in the repo; brand
overrides (name, logo, accent) come from `lms.config.ts` and are applied as CSS variables at the
root, never as new utilities.

## Palette roles

| Token                                       | Light                                             | Dark       | Use                                                            |
| ------------------------------------------- | ------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| `--background`                              | `#f6f4ef` paper                                   | `#161514`  | page canvas                                                    |
| `--card` / `--popover`                      | `#fdfcf9`                                         | `#1e1c1a`  | surfaces                                                       |
| `--foreground`                              | `#1e1c19` ink                                     | `#e9e5dc`  | text                                                           |
| `--muted-foreground`                        | `#6b665e`                                         | `#a39d92`  | secondary text, metadata                                       |
| `--border`                                  | ink at 12 %                                       | paper 10 % | hairlines                                                      |
| `--accent`                                  | ink at 5 %                                        | paper 6 %  | hover and selected backgrounds                                 |
| `--primary`                                 | `#2f6f6d` lake                                    | `#7fb5b2`  | **actions and progress only** — one filled button per screen   |
| `--link`                                    | `#255a58`                                         | `#8fc3c0`  | inline links (darker than primary for AA on paper)             |
| `--success` / `--warning` / `--destructive` | `#587a5a` moss · `#b8862d` amber · `#a34a3e` clay | tuned      | states, always paired with a word or glyph, never colour alone |
| `--info`                                    | `#4b6a8a`                                         | `#93accb`  | neutral notices                                                |

**Never** a raw Tailwind palette utility (`slate-*`, `gray-*`, `emerald-*`) and never a hex in a
component: a cool grey or a saturated blue in a view means the theme leaked.

## Type

- **Literata** (variable, `@fontsource-variable/literata`) is the reading face: `h1`, course and
  lesson titles, and the lesson prose (`.prose`). It is a book face, so it carries long text well;
  keep it out of controls, tables and labels.
- **Source Sans 3** (variable, `@fontsource-variable/source-sans-3`) for everything else. `h2`–`h4`
  are `font-semibold tracking-tight`. Small labels may use `text-xs uppercase tracking-[0.06em]`,
  sparingly — section eyebrows and status tags, not buttons.
- Lesson prose: `max-w-[68ch]`, `text-[1.0625rem]`, `leading-[1.65]`; paragraphs separated by
  space, not indents. Durations, counts and scores use `tabular-nums`.
- Both faces are open licences shipped from npm; nothing in `public/fonts`.

## Shape and depth

- Two radii and nothing rounder: controls `rounded` = `--radius: 0.25rem`; surfaces (cards,
  dialogs, the player frame) `rounded-lg` = `--radius-surface: 0.5rem`. Badges are square-ish
  (`rounded`), not pills. Avatars are the one circle.
- **No drop shadows, gradients, blur or translucency.** A surface is a hairline border on a
  slightly lighter fill. Hover is a background shift to `--accent`; selected is `--accent` plus a
  2 px left rule in `--primary`; focus is a 2 px `--ring` outline with offset.
- Progress is a 2 px rule (`ProgressRule`), never a ring or a percentage badge.
- Lock states are text: a lock glyph plus «Available from 12 March» generated from the rule type.

## Motion

`--ease: cubic-bezier(0.2, 0, 0, 1)` at 120 ms on colour, background and opacity. No scale or
slide on press or open; dialogs fade. `prefers-reduced-motion` keeps opacity and drops the rest.

## Layout

- Shell: a slim top bar (brand mark, locale, theme, account) over a `max-w-6xl` content column.
- Course page: syllabus rail on the left (`lg:` and up; stacked above on phones) — chapters as
  eyebrows, lessons as rows with a glyph column (✓ done · ● current · ○ todo · lock), a thin
  vertical rule ties the list together. Content column on the right.
- Lesson player: single column, `max-w-3xl`, blocks stacked with generous space, a sticky slim
  footer with previous · progress rule · next; ←/→ move between lessons. "Next" is never blocked.
- Admin and teacher tables are dense (`text-sm`, `py-2`), zebra-free, hairline row separators.

## Interaction rules

- One filled (`primary`) button per screen; the rest are `outline` or `ghost`. Destructive actions
  are `outline` until confirmed in `ConfirmDialog` (native `<dialog>`), never `window.confirm`.
- Every input has a visible label (`Field`); errors are text next to the control; touch targets
  ≥ 44 px on coarse pointers.
- Status is never colour alone: a locked lesson says why, a reviewed submission says «Reviewed».
- Filter and tab state lives in the URL so every view is bookmarkable.
- Contrast ≥ 4.5:1 for text in both themes; `--primary` is for fills and rules, `--link` for words.
