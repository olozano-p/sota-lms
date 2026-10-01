# ADR-019 · The theme is a directory; slots are compiled in, everything else is read at runtime

**Date** 2026-10-01 · **Status** accepted · Fulfils the promise in ADR-015 that brand leaves
`lms.config.ts` for `theme/theme.json` when theming lands.

## Decision

A deployment's look lives in one directory, `THEME_DIR` (default `./theme`), layered over the
defaults shipped in `src/theme/default/`:

| Part                       | Read              | Effect                                                                |
| -------------------------- | ----------------- | --------------------------------------------------------------------- |
| `theme.json`               | at runtime        | name, tagline, logo, favicon, colours, fonts, radius, spacing, locale |
| `custom.css`               | at runtime        | appended after every other stylesheet                                 |
| `messages/{ca,es,en}.json` | at runtime        | deep-merged over the shipped catalogues                               |
| `emails/*.html`            | at runtime        | replace the transactional layout, per name or for all                 |
| `assets/`                  | at runtime        | served at `/theme/assets/*`                                           |
| `slots/<Name>.tsx`         | **at build time** | replace one of seven named React components                           |

- **Tokens.** `theme.json` becomes CSS custom properties (`:root` and `.dark`), served together with
  `@font-face` rules and `custom.css` as one stylesheet, `/theme/theme.css?v=<hash>`, linked after the
  app stylesheet. Tailwind utilities map to those variables. `src/styles.css` holds no raw colour or
  font stack; tokens that can be derived from ink and paper (card, border, muted…) are derived
  unless the theme sets them. `lms.config.ts` keeps only non-visual settings; `brand`,
  `contactEmail` and `locales.default` are gone and a leftover key is rejected with a pointer to
  `theme.json`.
- **Validation.** Zod with strict objects; every value that reaches generated CSS matches a narrow
  grammar (hex/`rgb()`/`hsl()`/`oklch()` colours, CSS lengths, font-family lists), so a theme can
  restyle the app and a typo or hostile value cannot leave a declaration. Boot (`scripts/serve.mjs`),
  `vite dev`/`vite build` and `pnpm sota validate-theme` fail with one message listing every problem.
  Unknown message keys, dropped `{placeholders}`, unknown email or slot file names are warnings
  (`validate-theme --strict` fails on them); a missing asset, an email without `{{ctaUrl}}` or an
  unknown email placeholder are errors.
- **Slots.** A Vite plugin (`src/theme/vite-plugin.ts`) generates the virtual module
  `virtual:sota-theme-slots`, which imports, for each of the seven slot names, `<THEME_DIR>/slots/<Name>.tsx`
  when it exists and `src/theme/default/slots/<Name>.tsx` otherwise. The app therefore always has
  exactly one component per slot, with no runtime fallback logic, and the default slots are the real
  UI, not a parallel copy. Props are a typed contract (`src/theme/slots.ts`).
- **Assets** are looked up by decoded path segments against the same grammar as `theme.json`, must
  resolve (symlinks included) inside `assets/`, and only an allow-list of image and font types is
  served, with `nosniff`; SVG carries a sandbox CSP.
- **Emails** use `{{name}}` (escaped) and `{{{lines}}}` (markup built from escaped parts)
  placeholders, with the light palette and font stacks available as plain values. Lookup order:
  `emails/<kind>.html`, then the theme's `emails/layout.html`, then the shipped layout.

## Why slots are compiled in

A `.tsx` file cannot be mounted into a running image: it must be transpiled, it must share the
app's React instance, and, because the app is server-rendered and hydrated, the **client bundle**
must contain it too, which means rebuilding the client. Transpiling at boot with esbuild would still
leave the browser without the component, and loading arbitrary modules from a volume at runtime
would also make the theme directory executable code with the privileges of the server. Compiling the
slots at build time is the simplest sound option: Vite already bundles server and client from the
same module graph.

Trade-off accepted: **changing a slot means rebuilding the image** with the theme in the build
context (`docker build --build-arg THEME_DIR=...`, default `./theme`, which the image then also
carries as `/app/theme`). Everything else (colours, fonts, copy, mail, logo, assets, CSS) is
runtime: mount a different `theme/` over `/app/theme` and restart, no rebuild. If a mounted theme
contains slot files that the image was not built with, `validate-theme` and the boot log say so
instead of silently ignoring them.

## Consequences

- A second organisation changes nothing under `src/` to look different; the example themes in
  `examples/themes/` (and a test that loads both) are the proof.
- Do not re-propose runtime-loaded component code or a `theme/` directory with executable
  JavaScript. If non-developers need to restyle slots without a build, the answer is more tokens
  and more `theme.json` fields, not code at runtime.
- Message overrides and the shipped catalogues share one key set (`MessageKey` from `ca.ts`): a
  theme cannot add keys, only reword them. `messages/*.json` accepts flat dotted keys or nested objects.
- Server-side consumers (mail) read the theme through `getTheme()`; in development the files are
  re-read at most once per second, in production once per process.
