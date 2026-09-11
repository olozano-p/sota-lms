# ADR-007 · Content is Markdown

**Date** 2026-09-11 · **Status** accepted

## Decision

Rich text (lesson text blocks, course descriptions, assignment instructions, quiz intros, teacher
comments) is stored as Markdown in `*_md` columns and rendered with `marked`, then sanitised with
DOMPurify against an allowlist (`src/lib/markdown.ts`). The editor is a plain textarea with a live
preview and autosave on blur.

## Why

- Diffable, portable, exportable; a teacher can paste from anywhere and a fork can migrate away
  without a document-format converter.
- One dependency instead of an editor framework; the block model already gives structure
  (video, audio, file, quiz are blocks, not inline embeds), so the text itself stays simple.

## Consequences

- No WYSIWYG in v1. Rejected: Tiptap/ProseMirror JSON documents (better authoring feel, large
  surface, own sanitiser). Revisit if teachers ask for tables, footnotes or inline images at scale.
- Raw HTML in Markdown is stripped by the sanitiser; embeds go through the `embed` block and its
  domain allowlist.
