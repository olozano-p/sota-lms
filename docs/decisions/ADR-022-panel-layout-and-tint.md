# ADR-022 · Panels on paper, a sand tint and uppercase labels

**Date** 2026-10-17 · **Status** accepted · supersedes the faces and the "hairlines, no translucency"
rules of ADR-009 (which stays as written); extends ADR-019 (theme tokens and slots)

## Decision

- **The student interface follows the panel design** made for the first deployment: an off-white
  page, white rounded panels (the syllabus), a translucent sand for buttons, tags and course cards,
  serif titles and body, and 12 px uppercase tracked sans for every label, button and navigation
  link. It is final; the default theme ships a neutral look-alike and a deployment sets its own
  fonts and colours in `theme.json`.
- **One new colour token, `tint`** (`--tint`, `bg-tint`, `bg-tint/40`): the sand. Optional and
  derived (ink 9 % over paper in light, 14 % in dark), so existing themes keep working. `card` is
  now set explicitly by the default theme (white on an off-white paper) instead of equalling paper.
- **Faces.** Newsreader (serif, optical sizes) and DM Sans (sans, optical sizes) from
  `@fontsource-variable` replace Literata and Schibsted Grotesk: the design pairs a contemporary
  serif with DM Sans, and Newsreader is the closest open face. Lesson prose is serif
  0.9375 rem / 1.4: a touch larger and looser than the 14 px / 1.2 of the mock because Newsreader's
  x-height is smaller than the commercial face it stands in for.
- **A `label` utility** (`src/styles.css`) is the one definition of the uppercase style; `Eyebrow`,
  `Badge`, `Tabs`, buttons and the navigation use it. In lesson Markdown a `##` heading renders as a
  label, so a teacher can write «Materials» or «Schedule» sections like the panels.
- **Three radii from the two variables:** `rounded-sm` (half the control radius) for tags,
  `rounded` for controls and media, `rounded-lg` for panels and cards. Defaults 0.5 rem and 1 rem.
- **Translucency is allowed for fills only** (the tint at 40 % or 70 % on hover, the paper as a hover
  in a panel); text is not faded by opacity; still no shadows, gradients or blur.
  Student surfaces are told apart by fill, not hairlines; dense teacher and admin tables keep their
  row rules.
- **The `default` button is the tint button** with an ink label; the primary colour is for
  progress, status dots and focus, not fills.
- **The lesson lives inside the course frame**: `courses/$courseSlug/$lessonSlug` is a child of the
  course layout, which renders the syllabus panel beside every course page (welcome, lessons,
  forum). Same URLs; `forum` was already a reserved lesson slug.

## Why

The first deployment's design is the product the readers will see, and expressing it through
tokens keeps SOTA generic: the deployment's own fonts, sand and ink are three lines of
`theme.json`. A syllabus beside the lesson was the most requested missing piece of the old
single-column player.

## Consequences

- `tint` joins the palette, the email placeholders (`color.card`, `color.tint`) and the docs.
- The `CourseCard` and `LessonLayout` slot props grow (cover, state, position; meta, media). An
  older custom slot still compiles, but a `LessonLayout` written before this decision must render
  `media`: the opening video moved out of `children` and would otherwise not show.
- A theme that sets its own `ink` or `paper` does not inherit the default's `card` and `tint`; they
  derive from its palette (`withoutForeignDerived` in `src/theme/load.ts`).
- Dark mode stays, derived like every other token.
- Do not re-propose a fixed bottom bar for the lesson or hairline cards on student screens; the
  actions sit under the content and panels are fills.
