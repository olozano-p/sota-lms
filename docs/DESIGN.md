# SOTA — visual rules

SOTA is a place to read, watch and think. The interface should feel like a well-set page: white,
quiet, legible, with warm ink, one gold accent and nothing that shouts. Light is the default (lessons are
read); dark is a stored preference. Depth comes from hairlines and spacing, not shadows. The tokens
in `src/styles.css` are the only source of colour, radius, type and easing in the repo; brand
overrides (name, logo, accent) come from `lms.config.ts` and are applied as CSS variables at the
root, never as new utilities.

## Palette roles

| Token                                       | Light                                            | Dark                              | Use                                                            |
| ------------------------------------------- | ------------------------------------------------ | --------------------------------- | -------------------------------------------------------------- |
| `--background`                              | `#ffffff`                                        | `#161514`                         | page canvas                                                    |
| `--card` / `--popover`                      | `#ffffff`                                        | `#1e1c1a`                         | surfaces, set apart by a hairline, not by a fill               |
| `--foreground`                              | `#1e1c19` ink                                    | `#e9e5dc`                         | text                                                           |
| `--muted-foreground`                        | `#6b665e`                                        | `#a39d92`                         | secondary text, metadata                                       |
| `--border`                                  | ink at 12 %                                      | paper 10 %                        | hairlines                                                      |
| `--accent`                                  | ink at 5 %                                       | paper 6 %                         | hover and selected backgrounds                                 |
| `--primary`                                 | `#e0a51c` gold, ink text (7.7:1)                 | `#f0c455`                         | **actions and progress only** — one filled button per screen   |
| `--link`                                    | `#8c5f0a` ochre (5.6:1 on white)                 | `#f0c455`                         | inline links and the focus ring in light; gold is too pale     |
| `--success` / `--warning` / `--destructive` | `#587a5a` moss · `#c2661d` rust · `#a34a3e` clay | `#8bab8c` · `#dd8f52` · `#c8776b` | states, always paired with a word or glyph, never colour alone |
| `--info`                                    | `#4b6a8a`                                        | `#93accb`                         | neutral notices                                                |

Each state colour has a `-foreground` twin for text (`#3f5c41`, `#8a4712`, `#8a3a30`, `#3c5670` in
light) so words stay above 4.5:1 while the fill stays recognisable. Warning moved off gold when
gold became the accent.

**Never** a raw Tailwind palette utility (`slate-*`, `gray-*`, `emerald-*`) and never a hex in a
component: a cool grey or a saturated blue in a view means the theme leaked.

## Type

- **Literata** (variable, `@fontsource-variable/literata`) is the reading face: `h1`, course and
  lesson titles, and the lesson prose (`.prose`). It is a book face, so it carries long text well;
  keep it out of controls, tables and labels.
- **Schibsted Grotesk** (variable, `@fontsource-variable/schibsted-grotesk`) for everything else.
  Its large x-height and dark 400 weight hold up in a 14 px table on a 1× screen, and the angled
  terminals give it a voice without costing legibility. `h2`–`h4` are `font-semibold` with
  `tracking-[-0.01em]`; Schibsted is already compact, so Tailwind's `tracking-tight` closes the
  counters. Small labels may use `text-xs uppercase tracking-[0.06em]`, sparingly — section
  eyebrows and status tags, not buttons.
- Lesson prose: `max-w-[68ch]`, `text-[1.0625rem]`, `leading-[1.65]`; paragraphs separated by
  space, not indents. Durations, counts and scores use `tabular-nums` on the cell or span that holds
  them, never on a whole table: Schibsted's `tnum` also widens the full stop, so an email address in
  a tabular row reads «example . invalid».
- Both faces are open licences shipped from npm; nothing in `public/fonts`. If Schibsted reads too
  dark on 1× Windows after real use, the fallback is `@fontsource-variable/atkinson-hyperlegible-next`
  as a package swap and one name in `--font-sans`; no other token changes (ADR-009).

## Shape and depth

- Two radii and nothing rounder: controls `rounded` = `--radius: 0.25rem`; surfaces (cards,
  dialogs, the player frame) `rounded-lg` = `--radius-surface: 0.5rem`. Badges are square-ish
  (`rounded`), not pills. Avatars are the one circle.
- **No drop shadows, gradients, blur or translucency.** A surface is a hairline border on the
  same white. Hover is a background shift to `--accent`; selected is `--accent` plus a
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
