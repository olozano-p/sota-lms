# Theming

A deployment looks like itself without touching `src/`: it ships a **theme directory**
(`THEME_DIR`, default `./theme`) that is layered over the defaults in `src/theme/default/`. Every
part is optional; a directory with only `custom.css` is a valid theme, and no directory at all gives
the shipped look. Why it works this way, and why only slots need a build: ADR-019.

```
theme/
  theme.json            name, tagline, logo, favicon, colours, fonts, radius, spacing, language
  custom.css            appended after every other stylesheet
  messages/ca.json      reworded UI copy per language (also es.json, en.json)
  emails/layout.html    transactional mail layout; emails/<kind>.html per kind
  assets/               files served at /theme/assets/* (logo, favicon, fonts, images)
  slots/Header.tsx      React components replacing named parts of the UI (compiled in at build time)
```

| Part                       | Read at                                         | Change it with                  |
| -------------------------- | ----------------------------------------------- | ------------------------------- |
| `theme.json`, `custom.css` | runtime (production: once per process)          | edit and restart                |
| `messages/`, `emails/`     | runtime                                         | edit and restart                |
| `assets/`                  | runtime, per request                            | add or replace files            |
| `slots/`                   | **build time** (`vite build`, `vite dev` start) | rebuild the image / restart dev |

Check a theme with `pnpm sota validate-theme [dir] [--strict]` (in the container:
`docker compose exec app node scripts/sota.ts validate-theme`). The server, `vite dev` and
`vite build` refuse to start on an invalid theme and print every problem. `--strict` also fails on
warnings. Two complete examples to copy live in `examples/themes/` (`ledger`, `terminal`);
`THEME_DIR=examples/themes/ledger pnpm dev` shows one.

## theme.json

Every key is optional; a missing key keeps the shipped value (`src/theme/default/theme.json`).
Unknown keys are errors, so a typo is reported instead of silently ignored. Texts that depend on
the language accept a string or `{ "ca": ..., "es": ..., "en": ... }`; a language without an entry
falls back to `defaultLocale`, then to any entry.

| Field                         | Type                                            | Default           | Meaning                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                        | string, 1-80 chars                              | `SOTA`            | Product name in the header, footer, page title and mail.                                                                                                                                                                                                                                                                                 |
| `tagline`                     | localised text or `null`                        | `null`            | One line under the name (landing page, `<meta name="description">`, mail `{{tagline}}`).                                                                                                                                                                                                                                                 |
| `logo`                        | file in `assets/`, https URL, `null`            | `null`            | Replaces the built-in mark. SVG or PNG, about 28 px tall.                                                                                                                                                                                                                                                                                |
| `favicon`                     | file in `assets/`, https URL, `null`            | `null`            | `null` keeps `/favicon.svg`.                                                                                                                                                                                                                                                                                                             |
| `defaultLocale`               | `ca` \| `es` \| `en`                            | `ca`              | Language when `?lang`, the cookie, the profile and `Accept-Language` decide nothing. `DEFAULT_LOCALE` in `.env` wins. Must be enabled in `lms.config.ts`, else the first enabled one is used.                                                                                                                                            |
| `supportEmail`                | email or `null`                                 | `null`            | Shown in the footer and available to mail as `{{supportEmail}}`.                                                                                                                                                                                                                                                                         |
| `projectUrl`                  | http(s) URL or `null`                           | `null`            | Where "Made with SOTA" in the footer links; `null` leaves it as plain text.                                                                                                                                                                                                                                                              |
| `legalLinks`                  | up to 8 of `{ label, href }`                    | `[]`              | Footer links (privacy, terms). `label` is localised text; `href` is `https://`, `mailto:` or a path starting with `/`.                                                                                                                                                                                                                   |
| `colors.light`, `colors.dark` | palette (below)                                 | see below         | Colours per mode. Give only the keys you change.                                                                                                                                                                                                                                                                                         |
| `fonts.sans`                  | font-family list                                | Schibsted Grotesk | Interface font. Names, quotes, commas only (`"Inter", system-ui, sans-serif`).                                                                                                                                                                                                                                                           |
| `fonts.serif`                 | font-family list                                | Literata          | `h1`, course and lesson titles, lesson prose.                                                                                                                                                                                                                                                                                            |
| `fonts.mono`                  | font-family list                                | system mono       | Code.                                                                                                                                                                                                                                                                                                                                    |
| `fonts.faces`                 | up to 24 of `{ family, file, weight?, style? }` | `[]`              | Self-hosted faces: `file` is a `woff2`, `woff`, `ttf` or `otf` in `assets/`; `weight` is `400` or a range `100 900`; `style` is `normal` or `italic`. SOTA writes the `@font-face` rule; name the family in `fonts.*`. Remote font URLs are not supported (the CSP allows same-origin fonts only, and no third party sees your readers). |
| `radius.control`              | CSS length                                      | `0.25rem`         | Buttons, inputs, badges (`rounded`).                                                                                                                                                                                                                                                                                                     |
| `radius.surface`              | CSS length                                      | `0.5rem`          | Cards, dialogs, the player frame (`rounded-lg`).                                                                                                                                                                                                                                                                                         |
| `spacing.unit`                | CSS length                                      | `0.25rem`         | Tailwind's base unit: every `p-4`, `gap-6` is a multiple of it. Scales the whole layout.                                                                                                                                                                                                                                                 |
| `spacing.contentWidth`        | CSS length                                      | `72rem`           | Width of the page column (header, content, footer).                                                                                                                                                                                                                                                                                      |
| `spacing.proseWidth`          | CSS length                                      | `68ch`            | Measure of lesson text.                                                                                                                                                                                                                                                                                                                  |

Lengths are `0` or a number with `px`, `rem`, `em`, `ch`, `vw`, `vh` or `%`. Colours are `#rgb`,
`#rrggbb`, `#rrggbbaa`, or `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()`; nothing else
is accepted, because these strings become CSS.

### Palette

`colors.light` and `colors.dark` take these keys; each becomes a CSS variable on `:root` / `.dark`.

| Key                                                               | Variable                                        | Role                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `ink`, `paper`                                                    | `--ink`, `--paper`                              | Text and page canvas. Hairlines, hover and muted fills are derived from them. |
| `primary`, `primaryForeground`                                    | `--brand-primary`, `--brand-primary-foreground` | Actions and progress: fills and rules, never words.                           |
| `link`                                                            | `--brand-link`                                  | Inline links and (light mode) the focus ring; needs 4.5:1 on `paper`.         |
| `success`, `warning`, `destructive`, `info`                       | `--success`, ...                                | State fills; each has a `...Foreground` twin for words (4.5:1 on `paper`).    |
| `card`, `popover`                                                 | `--card`, `--popover`                           | Surfaces. Derived (`paper` in light; a touch of `ink` in dark) unless set.    |
| `mutedForeground`                                                 | `--muted-foreground`                            | Secondary text. Derived from `ink` over `paper` unless set.                   |
| `border`, `input`, `muted`, `accent`, `secondary`, `code`, `ring` | `--border`, ...                                 | Hairlines and fills. Derived from `ink` unless set.                           |

Anything else in `custom.css` should use these variables (`var(--primary)`, `var(--border)`) rather
than literal colours, so dark mode and later theme changes keep working. Tailwind utilities
(`bg-primary`, `text-muted-foreground`, `rounded-lg`, `max-w-content`) resolve to the same variables.

## messages

`messages/<locale>.json` rewords the interface. Keys are the catalogue keys (`src/i18n/ca.ts`); write
them flat (`"home.title": "..."`) or nested (`{ "home": { "title": "..." } }`). Values replace the
shipped text for that language; `{placeholders}` must be kept (dropping one is a warning). A key that
does not exist is ignored with a warning. You can reword, not add: new copy needs a slot.

## emails

`emails/layout.html` wraps every transactional mail (account links, notifications, the digest);
`emails/<kind>.html` wraps one kind. Lookup: `<kind>.html`, then your `layout.html`, then the
shipped one. Kinds: `submission_received`, `feedback_returned`, `chapter_released`, `forum_reply`,
`forum_thread`, `auth_magic_link`, `auth_verify_email`, `auth_reset_password`, `auth_invite`, `digest`.
Subjects and the plain-text part come from the message catalogue (reword them in `messages/`).

`{{name}}` inserts escaped text; `{{{lines}}}` inserts the body paragraphs (already escaped markup)
and must be written with three braces. Every template must contain `{{ctaUrl}}`.

| Placeholder                                                                                                         | Value                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `brand`                                                                                                             | `name` from theme.json                                                 |
| `title`, `lines`, `ctaLabel`, `ctaUrl`                                                                              | The message: subject, body paragraphs, button text and link            |
| `tagline`, `supportEmail`                                                                                           | From theme.json in the recipient's language (empty if unset)           |
| `color.ink`, `color.paper`, `color.muted`, `color.border`, `color.primary`, `color.primaryForeground`, `color.link` | The light palette as plain values (mail clients have no CSS variables) |
| `font.sans`, `font.serif`                                                                                           | The font stacks (clients without your font fall back)                  |

## assets

Files in `assets/` are served at `/theme/assets/<path>` (public, no sign-in, `Cache-Control: public,
max-age=3600`). Only images (`png`, `jpg`, `webp`, `gif`, `avif`, `svg`, `ico`) and fonts (`woff2`,
`woff`, `ttf`, `otf`) are served; anything else, a path with `..`, a hidden segment, a backslash or
a symlink that leaves `assets/` answers 404. SVG is served sandboxed (no script runs when opened
directly). Do not put anything private there.

## custom.css

Served as the last part of `/theme/theme.css`, after the variables and font faces, so equal-specificity
rules win. It is operator-written CSS and is not sanitised: you own what it does.

## slots

A slot is a named part of the interface a theme may replace. Shipping `slots/<Name>.tsx` with a
default export swaps the component; without the file the default in
`src/theme/default/slots/<Name>.tsx` is used. **Slots are compiled into the bundle**: add, change or
remove one and rebuild (`pnpm build`; the Docker image with `--build-arg THEME_DIR=path/to/theme`,
default `./theme`, so the theme must be inside the build context), or restart `pnpm dev`. Only the
slot files need the build: the rest of the theme can be mounted over `/app/theme` at runtime.

A slot may import `react`, `lucide-react`, `@tanstack/react-router`, the primitives in
`~/components/ui/*` and the hooks in `~/i18n`. Use tokens (`bg-card`, `text-primary`, `var(--border)`),
never literal colours. Types: `import type { HeaderProps } from "~/theme/slots"`. A slot is rendered
by the app on both server and client, so it must not read `window` during render.

### Slot contracts

All props are plain data or ready-made React nodes. `brand` is `ThemeBrand`:
`{ name, tagline | null, logoUrl | null, supportEmail | null, projectUrl | null, legalLinks: { label, href }[] }`,
already resolved for the reader's language.

| Slot           | Replaces                                                                              | Props                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Header`       | the top bar of every page                                                             | `brand`; `nav`: account menu or sign-in link; `localeSwitch`: language picker (empty with one language); `themeToggle`: light/dark. Render all three nodes somewhere visible.                                                                                      |
| `Footer`       | the bottom line of every page                                                         | `brand` (use `legalLinks`, `supportEmail`, `projectUrl`).                                                                                                                                                                                                          |
| `Home`         | the signed-out landing page at `/`                                                    | `brand`; `loginFailed: boolean`: show an error after a failed sign-in; `loginHref: string`: where the sign-in button points. Signed-in people never see it.                                                                                                        |
| `LoginPage`    | the frame around every account form (sign-in, sign-up, password recovery, invitation) | `brand`; `title: string`; `lead: string \| null`; `children`: the forms and links, which you must render.                                                                                                                                                          |
| `CourseCard`   | one course in the `/courses` list                                                     | `course: { slug, title, subtitle \| null, status: "draft" \| "published" \| "archived", privileged, lockMessage \| null, progress: { completed, total, ratio } }`. Must render one `<li>`; the route owns the `<ul>`. Link to `/courses/$courseSlug`.              |
| `LessonLayout` | the article frame and heading of a lesson                                             | `course: { slug, title }`; `chapter: { title }`; `lesson: { title, summary \| null }`; `position: { index, total }`; `draftPreview: boolean`; `children`: blocks or the lock notice; `footer`: mark-as-done row and previous/next bar, render it after `children`. |
| `EmptyState`   | every "nothing here yet" box                                                          | `title: string`; `children?`: optional explanation.                                                                                                                                                                                                                |

The examples in `examples/themes/*/slots/Header.tsx` are the smallest working slots.

## Building a theme

1. Copy `examples/themes/ledger` (or `terminal`) to `theme/` and change `theme.json`.
2. `pnpm sota validate-theme`, then `pnpm dev` and reload: `theme.json`, `custom.css`, messages and
   mail layouts are re-read within a second in development.
3. Add slots only where tokens are not enough, then restart `pnpm dev`.
4. Production: mount `theme/` at `/app/theme` (see `compose.yml`) and restart; build a new image
   only when a slot changed.
