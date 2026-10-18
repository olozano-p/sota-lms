# ADR-024 · Images shown at display size, kept by the browser

**Date** 2026-10-18 · **Status** accepted · extends ADR-012 (storage) and ADR-010 (inline images)

## Decision

- **`/api/files/$fileId?w=<px>`** on a JPEG, PNG or WebP answers, after the same access cascade as
  every other request, with a WebP copy no wider than one of 400, 800, 1200 or 1600 px (`w` snaps
  up; never enlarged; EXIF orientation applied, metadata dropped). The copy is made with `sharp` on
  the first request and stored beside the original as `variants/<key>/v<n>-w<width>.webp`, through
  the same `StorageProvider`; later requests read it back (`src/server/services/storage/variants.ts`).
- **The copy is served by the route itself**, not through a signed URL, with an ETag
  (`<file id>-<size>-w<width>-v<n>`) and `cache-control: private, no-cache`. The browser keeps it
  indefinitely and revalidates on every view: the access check runs each time and an unchanged
  image costs a 304 without a body.
- **Pages ask for it**: course covers at 800 px (`queries/covers.ts`), stored images in rendered
  Markdown (lessons, descriptions, forum posts, assignments, quizzes) at 1200 px with
  `loading="lazy"` (`renderMarkdown`). Without `w`, or for any other type (SVG, GIF, PDFs, audio),
  the route still redirects to a signed URL of ≤ 5 minutes.

## Why

- Covers arrived from the WordPress migration as ~2 MB PNGs shown 300 px wide: a learner with
  twenty courses downloaded ~40 MB to see the course list, again on every visit, because the
  redirect and the stored object were both `no-store` and the signed URL changed every time.
- Copies made on demand need no change to uploads, `file` rows, export/import or the seed, and
  optimise images already stored without rewriting them.
- A stable address with revalidation keeps the rule that nobody gets bytes without a fresh access
  check, which a long `max-age` (or a long-lived signed URL) would give up on shared computers.

## Consequences

- `sharp` is a runtime dependency (prebuilt for the Alpine image; kept out of the Vite bundle).
- Storage grows by the copies, a fraction of the originals. Like originals, they are not deleted
  when their file goes (ADR-012, still open).
- The first view of each image at each width pays the resize (a fraction of a second for a large
  PNG); concurrent first views may both resize and write the same bytes.
- A change to the encoding bumps `VARIANT_VERSION`: new copies are made and browsers drop the old.
- Not re-proposed: re-encoding originals in place; a long `max-age` on private images; an image
  CDN or proxy service.
