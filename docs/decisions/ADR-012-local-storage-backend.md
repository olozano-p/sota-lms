# ADR-012 · Storage behind a provider interface, a local directory by default

**Date** 2026-09-15 · **Status** accepted · amends the storage rows of `docs/spec.md` §0, §2 and §9

## Decision

File storage is one interface, `StorageProvider` (`src/server/services/storage/types.ts`): a
signed PUT URL, a signed GET URL, a HEAD after upload and a server-side write. Two drivers
implement it, chosen by `STORAGE_DRIVER`:

- **`local`** (default). Objects live under `STORAGE_DIR` (`data/uploads` in dev, an absolute path
  required in production), their content type in a sidecar. A "signed URL" is
  `/api/storage/<token>`: a base64url payload (operation, key, type, size or filename, expiry)
  signed with HMAC-SHA256 over the session secret. One route honours it: PUT streams the body to
  a temp file and refuses anything but exactly the signed size and type; GET streams the object
  with the signed disposition, byte ranges and a `default-src 'none'; sandbox` policy.
- **`s3`**. The previous code, unchanged in behaviour: presigned URLs against any S3 API, a
  public endpoint when browsers reach the bucket through another hostname.

Who may see or write a file is decided exactly where it was: the `request*Upload` mutations mint
PUT URLs, `/api/files/$fileId` mints GET URLs after its access cascade. The storage route never
looks at a session; the token is the credential, as a presigned URL was.

## Why

- MinIO was two containers, a second public hostname, a CORS assumption nobody configured and a
  storage layer no unit test could import (its env getters threw without `S3_*`). Contributors
  and CI now need Postgres and the mock IdP only.
- The spec's goal is a lean LMS a small organisation runs on one VPS. A directory is the honest
  "no S3" option there; a bucket stays one variable away for larger or multi-host deployments.
- Uploads capped at 200 MB stream through Node without buffering; at that size the hop through
  the app costs nothing a reverse proxy notices.

## Consequences

- `STORAGE_DIR` is state: back it up with the database, keep it outside pruned release
  directories (`/srv/sota/shared/uploads` for rsync deploys, the `uploads` volume under Docker),
  and let the proxy pass 200 MB bodies on `/api/storage/`. The app is no longer stateless.
- The security middleware leaves a header alone when the handler already set it, so stored
  files carry their stricter CSP. `/api/storage/` has its own rate bucket: a page of inline
  images costs a redirect plus a fetch each.
- Existing S3 deployments add `STORAGE_DRIVER=s3` to `.env`; nothing else changes for them.
- The seed script writes its placeholder files through the same `putObject`, so a fresh checkout
  plays the demo audio without credentials.
- Not re-proposed: MinIO in the compose files; browser uploads straight to a bucket in dev; a
  third driver before someone needs it. Deleting objects when their rows go is still open, as
  before.
