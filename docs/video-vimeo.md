# Video on Vimeo

Lodrö does not host or transcode video. Lessons reference a video at a provider; `VimeoProvider`
(`src/server/services/video/vimeo.ts`) is the v1 implementation of the `VideoProvider` interface
(ADR-005). Another provider is a contribution behind the same interface.

## Set up the Vimeo account

1. Upload the videos to the organisation's Vimeo account (any paid plan; embeds on a custom domain
   need Plus or above).
2. Per video (or as the account default), set **Privacy → Who can watch: Hide from Vimeo** and
   **Where can this be embedded: Specific domains**, listing the LMS hostname (e.g.
   `learn.example.org`). Students then cannot find the video on vimeo.com nor embed it elsewhere.
3. Create a personal access token at https://developer.vimeo.com/apps with the `private` and
   `video_files` scopes and put it in `.env` as `VIMEO_ACCESS_TOKEN`. It is used only by
   teachers' "resolve" action to validate a URL and read title, duration and thumbnail; playback
   never touches the API.

## Authoring

In the editor, paste a Vimeo URL or id into a video block: `https://vimeo.com/123456789`,
`https://vimeo.com/123456789/abcdef1234` (unlisted, with hash) or `123456789`. Lodrö calls
`GET https://api.vimeo.com/videos/{id}` to confirm the video belongs to the account and stores
`{ provider: "vimeo", external_id, title, duration_s }` in the block payload. Without a token the
URL is accepted unverified and the title is left for the teacher to fill.

## Playback and progress

The player embeds `https://player.vimeo.com/video/{id}?dnt=1&title=0&byline=0&portrait=0` (do
not track, no chrome) and attaches `@vimeo/player` to it. The common event surface
(`timeupdate`, `pause`, `ended`) drives progress: the position is saved every ~10 s and on pause,
playback resumes from `lesson_progress.media_position_s`, and a media-only lesson is marked
completed at 90 %. Captions and playback speed are Vimeo's own controls; upload captions there.

`player.vimeo.com` is added to the CSP `frame-src` automatically because the provider is enabled.

## Not in v1

Signed per-view embeds (Vimeo's private-link tokens) — domain restriction covers the reference
deployment's threat model. Revisit if videos leak.
