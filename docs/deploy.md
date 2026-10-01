# Deploying SOTA

SOTA is one Node process plus PostgreSQL, behind a reverse proxy that terminates TLS. Files live
in a directory the process owns (default) or in an S3-compatible bucket. Everything specific to
your organisation lives in `.env` and `lms.config.ts`.

## Before you start

1. **Identity provider** registered with redirect URI `https://learn.example.org/auth/callback`
   (`docs/idp-integration.md`).
2. **Enrollment source** (optional: without one, admins enroll people by hand) implementing `docs/entitlements-contract.md` (pull URL + token, webhook
   secret).
3. **File storage**: a writable directory that survives deploys (`STORAGE_DIR`, the default
   `STORAGE_DRIVER=local`; uploads stream through the app, so the proxy must allow bodies up to
   `uploads.maxBytes` on `/api/storage/`), or `STORAGE_DRIVER=s3` with a private bucket on any
   S3 API. With S3, browsers talk to the bucket through short signed URLs, so its hostname must be
   reachable from them — a second hostname on your proxy set as `S3_PUBLIC_ENDPOINT`.
4. **SMTP** relay for notifications (or `MAIL_TRANSPORT=console` to log them).
5. **Vimeo** token if teachers should validate videos (`docs/video-vimeo.md`).

Copy `.env.example` to `.env` and fill every value; `SESSION_SECRET` is ≥ 32 random bytes. Edit
`lms.config.ts` (brand, locales, embed allowlist, upload limits, digest hour).

## Option A — Docker (default)

```bash
git clone https://github.com/olozano-p/sota-lms && cd sota-lms
cp .env.example .env && $EDITOR .env lms.config.ts
docker compose -f docker-compose.prod.yml up -d --build
```

The image runs `src/db/migrate.ts` on start (`MIGRATE=true`) and never seeds unless `SEED=true`.
It listens on `127.0.0.1:3003`; put `deploy/nginx.conf` (or the equivalent for Caddy/Traefik) in
front, with `TRUST_PROXY=true` so rate limiting sees the client address. Upgrades:

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Migrations are forward-only and run before the new code serves traffic; take a `pg_dump` first.

Uploads land in the `uploads` volume (`/app/data/uploads` in the container). Bind-mounting a host
directory instead works when it is owned by uid 1000 (`node` in the image).

**Managed services**: point `DATABASE_URL` at your Postgres and delete the `postgres` service;
set `STORAGE_DRIVER=s3` with the `S3_*` block and drop the `uploads` volume.

## Option B — rsync + pm2 on a VPS (alternative)

For a host that already runs Node applications without Docker:

- Node 24 and pnpm on the server; Postgres reachable from it.
- Environment in `/etc/sota/env` (chmod 600), the same variables as `.env`, with
  `STORAGE_DIR=/srv/sota/shared/uploads`: releases under `/srv/sota/releases` are pruned, so
  uploads must live outside them.
- `pm2` ecosystem file at `/srv/sota/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "sota",
      cwd: "/srv/sota/current",
      script: "scripts/serve.mjs",
      instances: 1,
      env_file: "/etc/sota/env",
      env: { NODE_ENV: "production" },
    },
  ],
};
```

- `deploy/rsync-deploy.sh user@host /srv/sota` builds locally, ships a release, migrates, flips
  `current`, reloads pm2 and rolls back if `/api/health` fails.

## Notifications

`scripts/serve.mjs` runs the notification tick every 15 minutes (`NOTIFY_INTERVAL_MS`). If you
prefer cron, set `NOTIFY_INTERVAL_MS=0` and add:

```
*/15 * * * *  cd /srv/sota/current && set -a && . /etc/sota/env && node scripts/notify.ts
```

The daily digest goes out during the hour configured in `lms.config.ts → notifications.digestHour`.

## Backups

- Postgres: `pg_dump -Fc sota > sota-$(date +%F).dump` nightly; keep 14 days.
- Files: `rsync -a` (or `tar`) of `STORAGE_DIR` nightly (the `uploads` volume under Docker); with
  `STORAGE_DRIVER=s3`, `mc mirror` to a second bucket or your provider's versioning.
- Nothing else is state; the in-memory rate limiter starts empty on every restart.

## Security checklist (docs/spec.md §8)

- [ ] `APP_URL` is `https://…` (Secure cookies, HSTS header on).
- [ ] `TRUST_PROXY=true` only behind a proxy you control.
- [ ] Proxy rate limits on `/auth/` and `/api/` (the app's in-process limiter is a fallback).
- [ ] `STORAGE_DIR` is outside the web root and the release directories, owned by the app user
      only; with S3, the bucket is private, only the app holds the keys, `S3_PUBLIC_ENDPOINT` is HTTPS.
- [ ] `ENTITLEMENTS_WEBHOOK_SECRET` and `ENTITLEMENTS_PULL_TOKEN` are long and random.
- [ ] Vimeo embeds restricted to your hostname.
- [ ] `/api/health` monitored.

## Smoke test after deploy

1. Open the site → redirected to your IdP → back on `/courses`.
2. As an admin, `/admin` lists you with your enrollments; push a test webhook and see it under
   `/admin/webhooks`.
3. As a teacher, create a course, upload a file, resolve a Vimeo URL, publish.
4. As a student, open the lesson, download the file, mark it done; check the digest mail arrives.

## Reference deployment

The first production instance is a small foundation's members' school (`docs/spec.md`,
Appendix A): the members' site is both IdP (better-auth OIDC Provider) and enrollment source,
mapping its membership tiers to per-course enrollments with the validity window it wants; files live in a directory
on the same VPS; mail goes through the organisation's SMTP relay; the proxy is nginx and the deploy is
Option B. None of that is in the code.
