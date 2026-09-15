# ADR-010 · A rich-text editor over Markdown

**Date** 2026-09-15 · **Status** accepted · amends ADR-007

## Decision

Rich text keeps being **stored as Markdown** in `*_md` columns and rendered by `renderMarkdown()`
(ADR-007), but it is now **edited in place** with Tiptap 3 (`RichTextField`,
`src/components/editor/RichTextField.tsx`): the document is loaded from Markdown and serialised back
to Markdown on every change through `@tiptap/markdown`. The same field edits lesson text blocks,
course descriptions, assignment instructions, quiz intros and forum posts.

Two additions travel with it:

- A YouTube or Vimeo page URL alone on its line is a video. `src/lib/video-links.ts` recognises the
  URL; the editor shows a player (`videoEmbed` node) and the renderer emits the iframe itself after
  sanitising. Users never write an `<iframe>`; the two embed hosts must stay in `embedAllowlist`.
- Images are uploaded through the existing presigned-PUT flow and referenced as
  `![alt](/api/files/<id>?inline=1)`, so they stay private and pass the same access check as any
  other file.

## Why

- Students write in the forum. A Markdown textarea is fine for teachers who author a few lessons,
  not for a question typed on a phone. ADR-007 named the revisit trigger ("inline images at
  scale") and this is it, with a second one: non-authors.
- Keeping Markdown as the storage format keeps every property ADR-007 bought: diffable, portable,
  one sanitiser, no document-format converter for a fork. Only the input surface changes.
- Tiptap is a headless editor framework, not a UI component library: the toolbar, dialogs and
  styles are the house primitives, so ADR-008 stands.

## Consequences

- Six `@tiptap/*` packages join the dependencies; `marked` and DOMPurify stay.
- A round-trip may re-serialise existing Markdown (emphasis characters, list markers, escaped
  punctuation). Content renders the same; diffs of old lessons will show noise the first time they
  are saved from the new editor.
- Underline, tables and raw HTML have no place in the editor because they have none in the stored
  format. Raw HTML in old content is still dropped by the sanitiser.
- The server-side preview endpoint is gone: what you see in the editor is set in the reader's prose
  column.
- Rejected again: storing Tiptap JSON or HTML (a second sanitiser path and a migration of every
  `_md` column for no reader-visible gain).
