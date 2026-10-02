# SOTA — visual rules

SOTA is a place to read, watch and think. The interface should feel like a well-set page: white,
quiet, legible, with warm ink, one gold accent and nothing that shouts. Light is the default (lessons are
read); dark is a stored preference. Depth comes from hairlines and spacing, not shadows. The tokens
are the only source of colour, radius, type, spacing and easing in the repo. Their values live in
`theme.json` (the shipped default is `src/theme/default/theme.json`; a deployment points `THEME_DIR`
at its own), reach the page as CSS variables through `/theme/theme.css`, and `src/styles.css` only
maps them to utilities and derives the optional ones. A theme restyles the app by changing
variables, never by adding utilities; layout it cannot reach with variables is a slot
(`docs/theming.md`).

## Palette roles

The values below are those of the default theme (`src/theme/default/theme.json`), not constants of
the code. A theme sets `ink`, `paper`, `primary`, `primaryForeground`, `link` and the four state
colours (each with a `-foreground` twin) per mode; everything marked _derived_ comes from ink and
paper in `src/styles.css` unless the theme sets it. A theme that sets a derived token in light
sets it in dark too.

| Token                                       | Light                                            | Dark                              | Use                                                            |
| ------------------------------------------- | ------------------------------------------------ | --------------------------------- | -------------------------------------------------------------- |
| `--background`                              | `#ffffff`                                        | `#161514`                         | page canvas                                                    |
| `--card` / `--popover`                      | _derived_: paper                                 | _derived_: ink 4 % into paper     | surfaces, set apart by a hairline, not by a fill               |
| `--foreground`                              | `#1e1c19` ink                                    | `#e9e5dc`                         | text                                                           |
| `--muted-foreground`                        | _derived_: ink 65 % over paper                   | _derived_: same                   | secondary text, metadata                                       |
| `--border`                                  | _derived_: ink at 12 %                           | _derived_: ink at 10 %            | hairlines                                                      |
| `--accent`                                  | _derived_: ink at 5 %                            | _derived_: ink at 6 %             | hover and selected backgrounds                                 |
| `--primary`                                 | `#e0a51c` gold, ink text (7.7:1)                 | `#f0c455`                         | **actions and progress only** — one filled button per screen   |
| `--link`                                    | `#8c5f0a` ochre (5.6:1 on white)                 | `#f0c455`                         | inline links and the focus ring in light; gold is too pale     |
| `--success` / `--warning` / `--destructive` | `#587a5a` moss · `#c2661d` rust · `#a34a3e` clay | `#8bab8c` · `#dd8f52` · `#c8776b` | states, always paired with a word or glyph, never colour alone |
| `--info`                                    | `#4b6a8a`                                        | `#93accb`                         | neutral notices                                                |

Each state colour has a `-foreground` twin for text (`#3f5c41`, `#8a4712`, `#8a3a30`, `#3c5670` in
light) so words stay above 4.5:1 while the fill stays recognisable. Warning moved off gold when
gold became the accent.

`--input`, `--muted`, `--secondary` and `--code` are derived the same way (ink at 5–18 %), and
`--ring` is the link colour in light and the primary in dark. Contrast of derived text stays at or
above 4.5:1 for any theme whose ink and paper do (muted-foreground mixes 65 % ink).

**Never** a raw Tailwind palette utility (`slate-*`, `gray-*`, `emerald-*`) and never a hex in a
component: a cool grey or a saturated blue in a view means the theme leaked.

## Type

Faces are the `--font-sans`, `--font-serif` and `--font-mono` variables from the theme; the names
below are the default theme's. A theme may ship its own files (`fonts.faces`, served from
`/theme/assets/`) or name system fonts. Components say `font-serif` for the reading roles and never
a family.

- **Literata** (variable, `@fontsource-variable/literata`) is the reading face: `h1`, course and
  lesson titles, and the lesson prose (`.prose`). It is a book face, so it carries long text well;
  keep it out of controls, tables and labels.
- **Schibsted Grotesk** (variable, `@fontsource-variable/schibsted-grotesk`) for everything else.
  Its large x-height and dark 400 weight hold up in a 14 px table on a 1× screen, and the angled
  terminals give it a voice without costing legibility. `h2`–`h4` are `font-semibold` with
  `tracking-[-0.01em]`; Schibsted is already compact, so Tailwind's `tracking-tight` closes the
  counters. Small labels may use `text-xs uppercase tracking-[0.06em]`, sparingly — section
  eyebrows and status tags, not buttons.
- Lesson prose: `max-w-measure` (`--measure`, default `68ch`; the `.prose` utility sets it), `text-[1.0625rem]`, `leading-[1.65]`; paragraphs separated by
  space, not indents. Durations, counts and scores use `tabular-nums` on the cell or span that holds
  them, never on a whole table: Schibsted's `tnum` also widens the full stop, so an email address in
  a tabular row reads «example . invalid».
- Both faces are open licences shipped from npm; nothing in `public/fonts`. If Schibsted reads too
  dark on 1× Windows after real use, the fallback is `@fontsource-variable/atkinson-hyperlegible-next`
  as a package swap and one name in `--font-sans`; no other token changes (ADR-009).

## Shape and depth

- Two radii and nothing rounder, both theme variables: controls `rounded` = `--radius` (default
  `0.25rem`); surfaces (cards, dialogs, the player frame) `rounded-lg` = `--radius-surface`
  (default `0.5rem`). Badges are square-ish
  (`rounded`), not pills. Avatars are the one circle.
- **No drop shadows, gradients, blur or translucency.** A surface is a hairline border on the
  same white. Hover is a background shift to `--accent`; selected is `--accent` plus a
  2 px left rule in `--primary`; focus is a 2 px `--ring` outline with offset.
- Progress is a 2 px rule (`ProgressRule`), never a ring or a percentage badge.
- Lock states are text: a lock glyph plus «Available from 12 March» generated from the rule type.

## Spacing and widths

`--spacing` is Tailwind's base unit (default `0.25rem`), so every `p-*`, `gap-*` and `m-*` scales
with the theme. `--content-width` (default `72rem`) is the page column, used as `max-w-content`;
`--measure` is the reading width, `max-w-measure`. Neither `max-w-6xl` nor `68ch` is written in a
component.

## Motion

`--ease: cubic-bezier(0.2, 0, 0, 1)` at 120 ms on colour, background and opacity. No scale or
slide on press or open; dialogs fade. `prefers-reduced-motion` keeps opacity and drops the rest.

## Layout

- Shell: a slim top bar (brand mark, locale, theme, account) over a `max-w-content` column. The bar, the footer, the landing, the sign-in frame, the course card, the lesson frame and the empty state are theme slots (`src/theme/default/slots`); a theme may replace any of them.
- Course page: syllabus rail on the left (`lg:` and up; stacked above on phones) — chapters as
  eyebrows, lessons as rows with a glyph column (✓ done · ● current · ○ todo · lock), a thin
  vertical rule ties the list together. Content column on the right.
- Lesson player: single column, `max-w-3xl`, blocks stacked with generous space, a sticky slim
  footer with previous · progress rule · next; ←/→ move between lessons. "Next" is never blocked.
- Admin and teacher tables are dense (`text-sm`, `py-2`), zebra-free, hairline row separators.
- Forum: the thread list is hairline rows in one card (avatar, title, one-line excerpt, meta),
  pinned rows under a «Pinned» eyebrow. In a thread the opening post has no card and no
  rule (a left rule is a citation), only the full prose size; replies are rows under hairlines at
  `0.95rem`. Author, role («Teacher», never colour alone), relative time with the exact instant on
  hover. Thread actions, post actions and reactions are quiet ghost buttons (`Button size="xs"`:
  11 px regular label, 12 px icon, 28 px tall; the 44 px touch target still applies), reactions with a
  count, `aria-pressed` when yours; the one filled button
  is «Post the reply». Avatars are initials on `--accent`, the one circle.
- Rich-text editor (`RichTextField`): a hairline toolbar of ghost icon buttons (`aria-pressed`
  for the marks at the cursor) over the writing surface, which is the reader's `.prose` column
  inside a `rounded` input border. Links and videos are asked for in a `PromptDialog`, never
  `window.prompt`. Video players and images sit in the flow at the prose measure.

## Interaction rules

- One filled (`primary`) button per screen; the rest are `outline` or `ghost`. Destructive actions
  are `outline` until confirmed in `ConfirmDialog` (native `<dialog>`), never `window.confirm`.
- Every input has a visible label (`Field`); errors are text next to the control; touch targets
  ≥ 44 px on coarse pointers.
- Status is never colour alone: a locked lesson says why, a reviewed submission says «Reviewed».
- Filter and tab state lives in the URL so every view is bookmarkable.
- Contrast ≥ 4.5:1 for text in both themes; `--primary` is for fills and rules, `--link` for words.
