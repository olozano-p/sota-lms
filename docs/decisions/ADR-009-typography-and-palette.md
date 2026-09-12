# ADR-009 — Schibsted Grotesk for the interface, white page, gold accent

**Date:** 2026-09-12 · **Status:** accepted

## Context

The first build shipped Literata for reading and Source Sans 3 for the interface on a warm paper
background with a lake-green accent. Source Sans 3 is legible but anonymous, and the review
asked for a UI face that stays readable in a dense 14 px admin table on a 1× screen while giving
SOTA a recognisable voice. Five pairs were set on the same specimen (course title, eyebrow, lesson
row, prose at 17 px / 1.65, a button, a table row with figures, a 12 px uppercase tag) and tested
with Catalan and Spanish strings: «L·lúcia», «Sessió d'avaluació», «¿Qué aprenderás?», «Aïllar»,
«façana», and `0123456789` in a table.

| Pair                                   | Verdict                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Literata + Atkinson Hyperlegible Next  | Most legible face on the list; its slashed 0 and marked I/l make a people table look like a log file.       |
| Newsreader + Public Sans               | One neutral face swapped for another; Newsreader gets spindly at 17 px without a large optical size.        |
| Piazzolla + Hanken Grotesk             | Warmest pair and the runner-up; Hanken's 400 is lighter than Source Sans at 13 px, wrong for tables.        |
| Source Serif 4 + **Schibsted Grotesk** | UI face wins: dark 400, large x-height, angled terminals keep glyphs apart. Source Serif is a lateral move. |
| Literata + Instrument Sans             | Distinctive at 16 px and above, narrow letters crowd email addresses at 13 px.                              |

Alegreya Sans and Spectral have no variable `@fontsource` build, Bricolage Grotesque has no
italics and Fraunces is a display face, so they were dropped before the specimen.

## Decision

- **Literata stays** as the reading face; nothing on the list reads better in the lesson column and
  it already has optical sizes, true italics and tabular figures.
- **Schibsted Grotesk** replaces Source Sans 3 for everything else, via
  `@fontsource-variable/schibsted-grotesk` (weights 400–900, italic, `tnum`).
- `h2`–`h4` tracking goes from `-0.025em` to `-0.01em`; Schibsted is already compact.
- `tabular-nums` stays per cell. The review proposed setting it once on `table`, but Schibsted's
  `tnum` feature also gives the full stop a figure-width advance, which breaks email addresses and
  identifiers in the same row.
- The page becomes **white** (`--background` and `--card` `#ffffff`); surfaces are told apart by the
  hairline alone. The accent becomes **gold** (`#e0a51c`, ink text, 7.7:1) with an ochre link colour
  (`#8c5f0a`, 5.6:1 on white). In dark both are `#f0c455`. Warning moves off gold to a rust
  (`#c2661d`, text `#8a4712`) so it cannot be mistaken for an action.
- The focus ring in light uses the link colour, not the accent: gold on white is 2.2:1, below the
  3:1 non-text minimum.
- The admin people filter gets a visible label, as every other input already has.

## Consequences

- Two dependencies change; nothing is self-hosted from `public/fonts`.
- The email template, the mock IdP page and the favicon carry the same values inline; they are the
  only places outside `src/styles.css` where a colour is written, and they change together.
- Fallback: if Schibsted reads too dark on 1× Windows after real use, swap the package for
  `@fontsource-variable/atkinson-hyperlegible-next` and the first name in `--font-sans`. No token
  changes.
