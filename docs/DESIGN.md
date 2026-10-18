# SOTA — visual rules

SOTA is a place to read, watch and think. The interface follows the panel design of ADR-022: a
quiet off-white page, white rounded panels, a translucent sand for buttons, tags and course cards,
serif titles and body, and small uppercase tracked labels for everything you click or scan. Light is
the default (lessons are read); dark is a stored preference. Depth comes from fills and spacing, not
shadows or hairlines. The tokens are the only source of colour, radius, type, spacing and easing in
the repo. Their values live in `theme.json` (the shipped default is `src/theme/default/theme.json`; a
deployment points `THEME_DIR` at its own), reach the page as CSS variables through
`/theme/theme.css`, and `src/styles.css` only maps them to utilities and derives the optional ones.
A theme restyles the app by changing variables, never by adding utilities; layout it cannot reach
with variables is a slot (`docs/theming.md`).

## Palette roles

The values below are those of the default theme (`src/theme/default/theme.json`), not constants of
the code. A theme sets `ink`, `paper`, `primary`, `primaryForeground`, `link` and the four state
colours (each with a `-foreground` twin) per mode; everything marked _derived_ comes from ink and
paper in `src/styles.css` unless the theme sets it. A theme that sets a derived token in light
sets it in dark too.

| Token                                       | Light                                            | Dark                              | Use                                                            |
| ------------------------------------------- | ------------------------------------------------ | --------------------------------- | -------------------------------------------------------------- |
| `--background`                              | `#f3f3f0` paper                                  | `#161615`                         | page canvas; also the selected row inside a panel              |
| `--card` / `--popover`                      | `#ffffff`                                        | `#1f1f1d`                         | panels (the syllabus, forms, dialogs), set apart by their fill |
| `--tint`                                    | `#e4e2dc` sand                                   | `#2c2b28`                         | buttons and course cards at 40 %, tags and navigation whole    |
| `--foreground`                              | `#1a1a18` ink                                    | `#e8e6e1`                         | text                                                           |
| `--muted-foreground`                        | _derived_: ink 65 % over paper                   | _derived_: same                   | secondary text, metadata                                       |
| `--border`                                  | _derived_: ink at 12 %                           | _derived_: ink at 10 %            | hairlines                                                      |
| `--accent`                                  | _derived_: ink at 5 %                            | _derived_: ink at 6 %             | hover and selected backgrounds                                 |
| `--primary`                                 | `#2d6a64` teal                                   | `#7fc4b8`                         | **progress, status dots and focus only** — never a button fill |
| `--link`                                    | `#2d6a64`                                        | `#8fd0c4`                         | inline links in prose and the focus ring in light              |
| `--success` / `--warning` / `--destructive` | `#587a5a` moss · `#c2661d` rust · `#a34a3e` clay | `#8bab8c` · `#dd8f52` · `#c8776b` | states, always paired with a word or glyph, never colour alone |
| `--info`                                    | `#4b6a8a`                                        | `#93accb`                         | neutral notices                                                |

Each state colour has a `-foreground` twin for text (`#3f5c41`, `#8a4712`, `#8a3a30`, `#3c5670` in
light) so words stay above 4.5:1 while the fill stays recognisable. `card` and `tint` are optional
for a theme: unset, `card` is the paper (ink 4 % into paper in dark) and `tint` is ink 9 % over paper
(14 % in dark). A theme that sets its own `ink` or `paper` for a mode derives them from its own palette;
the default's white card and sand are not carried over.

`--input`, `--muted`, `--secondary` and `--code` are derived the same way (ink at 5–18 %), and
`--ring` is the link colour in light and the primary in dark. Contrast of derived text stays at or
above 4.5:1 for any theme whose ink and paper do (muted-foreground mixes 65 % ink).

**Never** a raw Tailwind palette utility (`slate-*`, `gray-*`, `emerald-*`) and never a hex in a
component: a cool grey or a saturated blue in a view means the theme leaked.

## Type

Faces are the `--font-sans`, `--font-serif` and `--font-mono` variables from the theme; the names
below are the default theme's. A theme may ship its own files (`fonts.faces`, served from
`/theme/assets/`) or name system fonts. Components say `font-serif` or the `label` utility, never a
family.

- **Newsreader** (variable with optical sizes, `@fontsource-variable/newsreader`) is the serif:
  titles (`h1` is 1.5 rem / 1.2, medium), syllabus rows, course cards, summaries and lesson prose.
- **DM Sans** (variable with optical sizes, `@fontsource-variable/dm-sans`) is the sans, almost
  always through the **`label`** utility: 12 px, medium, uppercase, `tracking-[0.1em]`,
  `leading-[1.2]`. Breadcrumbs, tags, eyebrows, navigation, table heads and buttons (semibold) use
  it. Forms and dense teacher and admin tables keep sentence-case sans at `text-sm`.
- Lesson prose (`.prose`): serif 0.9375 rem / 1.4, text at `--measure`; a video line spans the column.
  A `##` heading renders as a section label («Materials», «Schedule»); `###` is a serif subheading.
- Durations, counts and scores use `tabular-nums` on the span that holds them.

## Shape and depth

- Three radii from two variables: tags `rounded-sm` (half of `--radius`), controls, media and
  syllabus rows `rounded` (`--radius`, default 0.5 rem), panels and cards `rounded-lg`
  (`--radius-surface`, default 1 rem). Circles are for avatars, the audio play button, status dots
  and the ends of the progress rule.
- **No drop shadows, gradients or blur.** Translucency only on fills: the tint at 40 % (buttons,
  course cards, notices) or 70 % (hover), the paper as a hover inside a panel, and the dialog
  backdrop. Text is never faded by opacity, except closed rows (40 %), which say why in words. Student
  surfaces are told apart by fill: a white panel on paper, a sand card on paper, the selected row
  in paper inside a white panel. Teacher and admin tables keep hairline row separators.
- Focus is a 2 px `--ring` outline with offset. Progress is a 4 px rounded rule on the sand
  (`ProgressRule`), never a ring or a percentage badge.
- Lock states are text: a faded row keeps its reason in `title` and sr-only text, a closed chapter
  shows the date it opens, a locked page shows `LockNotice`.

## Spacing and widths

`--spacing` is Tailwind's base unit (default `0.25rem`), so every `p-*`, `gap-*` and `m-*` scales
with the theme. `--content-width` (default `87rem`) is the page column, used as `max-w-content`;
`--measure` is the reading width, `max-w-measure`. Neither `max-w-6xl` nor `68ch` is written in a
component.

## Motion

`--ease: cubic-bezier(0.2, 0, 0, 1)` at 120 ms on colour, background and opacity. No scale or
slide on press or open; dialogs fade. `prefers-reduced-motion` keeps opacity and drops the rest.

## Layout

- Shell: a slim bar on the page (mark on the left; navigation, locale, theme and sign-out as labels
  on the right, the current section in a sand box) over a `max-w-content` column; a label footer.
  The bar, the footer, the landing, the sign-in frame, the course card, the lesson frame and the
  empty state are theme slots (`src/theme/default/slots`).
- **My courses** (`/courses`): a centred 52 rem column (between `max-w-3xl` and `max-w-4xl`). «In progress» and «Finished» as serif
  section heads, each a list of course cards: sand at 40 %, the cover on the left (a sand block
  with the mark when there is none; stacked on phones), title, subtitle, a «Chapter 2 of 9» tag, a
  status dot with its word, and an underlined label link at the bottom. Finished cards fade the cover to 50 % and set their text in `muted-foreground`.
- **Course frame** (`courses/$courseSlug` layout): the syllabus panel on the left (20 rem, sticky,
  starting 3.25 rem below the top of the frame (which keeps 2 rem under the top bar), its panel level
  with the first line under the lesson title, and sticking 1.5 rem from the top once scrolled; a
  «← My courses» tag above it; on phones a «Syllabus» disclosure above the content), 1.5 rem
  from the content, 4.5 rem from `xl` up, and the
  course page, a lesson or the course forum on the right. The panel: the course page («Overview»; «Presentació», «Presentación»),
  chapters as collapsible serif rows with a caret and, when closed to the reader, faded with the
  date they open; lessons indented, the current one on paper, done ones with a small check; «Forum»
  at the bottom when on.
- **Page head**: a label breadcrumb («My courses / Course / Chapter») over the serif title, then an
  optional row of label metadata.
- **Lesson**: the opening video at full column width, then «Chapter 2 · Lesson 7 · Teacher · 50 min»
  as labels, the summary, the blocks, and the actions inline at the bottom: «Mark as done» (the tint
  button), «Previous» and «Next lesson» as underlined labels; ←/→ move between lessons and "Next" is
  never blocked. Consecutive files, audios and activities are one labelled list each: files and
  activities are an icon plus an underlined label; an audio is a round play button plus «Title ·
  12 min», with a seek bar once started.
- Admin and teacher tables are dense (`text-sm`, `py-2`), zebra-free, hairline row separators.
- Forum: the thread list is rows in one panel (avatar, title, one-line excerpt, meta), pinned rows
  under a «Pinned» label. In a thread the opening post has no panel, only the full prose size;
  replies are rows at `0.95rem`. Author, role («Teacher», never colour alone), relative time with
  the exact instant on hover. Thread actions, post actions and reactions are quiet ghost buttons
  (`Button size="xs"`: 11 px sentence-case label, 12 px icon, 28 px tall; the 44 px touch target
  still applies), reactions with a count, `aria-pressed` when yours. Avatars are initials on the sand.
- Rich-text editor (`RichTextField`): a toolbar of ghost icon buttons (`aria-pressed` for the marks
  at the cursor) over the writing surface, which is the reader's `.prose` column inside a `rounded`
  input border. Links and videos are asked for in a `PromptDialog`, never `window.prompt`.

## Interaction rules

- The screen's action is the `default` button (sand at 40 %, ink label, 48 px); secondary actions are
  `link` (an underlined label), `outline` or `ghost`. Destructive actions are `outline` until
  confirmed in `ConfirmDialog` (native `<dialog>`), never `window.confirm`.
- Every input has a visible label (`Field`); errors are text next to the control; touch targets
  ≥ 44 px on coarse pointers.
- Status is never colour alone: a locked lesson says why, a reviewed submission says «Reviewed».
- Filter and tab state lives in the URL so every view is bookmarkable.
- Contrast ≥ 4.5:1 for text in both themes: quiet labels are `text-muted-foreground` (ink 65 %),
  not ink at 50–60 % opacity, which drops below 4.5:1 at 12 px. Only closed rows fade (40 %), and
  they carry their reason in words. `--primary` is for dots, rules and focus, `--link` for words in
  prose.
