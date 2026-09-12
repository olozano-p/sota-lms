# ADR-005 · Video behind a provider interface, Vimeo first

**Date** 2026-09-11 · **Status** accepted

## Decision

Video is never stored or transcoded by SOTA. A `video` block holds `{ provider, external_id,
title, duration_s }`; `VideoProvider` (`src/server/services/video/provider.ts`) resolves a URL or
id into metadata and produces an embed. `VimeoProvider` is the v1 implementation; the player
component normalises the provider's events into `timeupdate` / `pause` / `ended` so progress
tracking is provider-agnostic. Audio and PDFs go to object storage instead (signed URLs after an
access check).

## Why

- Hosting video well (transcoding, adaptive bitrate, captions, CDN) is a product in itself; the
  reference deployment already pays Vimeo for it.
- An interface keeps the core generic: YouTube, Mux or a self-hosted HLS player are contributions,
  not forks.

## Consequences

- Access control for video is delegated to the provider's domain restriction; SOTA controls who
  sees the _page_, Vimeo controls where the _player_ may be embedded (`docs/video-vimeo.md`).
- Rejected: uploading video to S3 and serving it with `<video>` (no adaptive bitrate, huge egress);
  a hard dependency on `@vimeo/player` outside the provider adapter.
- Signed per-view embeds are deferred; the interface leaves room for them (`embed()` may become async).
