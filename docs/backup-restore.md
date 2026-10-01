# Backup and restore

What is state, how to save it, how to bring it back, and how to prove that it works. The commands
below were run against a scratch Postgres 16 container and a scratch volume (the drill at the end);
`compose.yml` is assumed, with its project name `sota-prod` and volumes `sota-prod_pgdata` and
`sota-prod_uploads`. Run them from the directory that holds `compose.yml` and `.env`.

## What to save

| State                | Where                                                                                                   | How                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The database         | Postgres (`pgdata` volume)                                                                              | `pg_dump -Fc`, nightly                                                   |
| Uploaded files       | `STORAGE_DIR` (the `uploads` volume) or the S3 bucket                                                   | tar of the volume, or bucket versioning / mirroring                      |
| Secrets and settings | `.env` (`SESSION_SECRET`, `POSTGRES_PASSWORD`, `OIDC_CLIENT_SECRET`, `S3_*`, `SMTP_*`, tokens)          | copy to a password manager or encrypted store, **not** next to the dumps |
| Local configuration  | `lms.config.ts` if you mount your own; the `compose.yml` you run                                        | keep in git                                                              |
| The theme            | the `theme/` directory (`THEME_DIR`): `theme.json`, `custom.css`, messages, mail layouts, assets, slots | keep in git; slots are compiled into the image you built from it         |

Nothing else is state. Sessions live in the database; the rate limiter's counters and the OIDC
transaction cache are in memory and start empty after a restart. The image is rebuilt or pulled
from the registry; do not back it up.

The database and the files belong together: a dump refers to files by key (`courses/<id>/...`,
`submissions/...`, `forum/...`). Take them at about the same time and restore them as a pair. Files that
exist without a database row are harmless; rows without a file show as a missing download.

**`SESSION_SECRET`** signs sessions, one-time links and local storage tokens. Restoring with another
value is safe but signs everybody out and invalidates unused magic and reset links.

## Back up

```bash
set -a; . ./.env; set +a
mkdir -p backup
stamp=$(date +%F)

# 1. Database: custom format (compressed, restorable table by table).
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-sota}" -Fc "${POSTGRES_DB:-sota}" \
  > "backup/sota-$stamp.dump"

# 2. Files: the uploads volume, with ownership preserved. Skip with STORAGE_DRIVER=s3.
docker run --rm -v sota-prod_uploads:/data:ro -v "$PWD/backup":/backup alpine \
  tar czf "/backup/uploads-$stamp.tgz" -C /data .
```

Keep 14 days locally and a weekly copy off the machine (another provider or region). With `s3`, turn on
object versioning (or mirror to a second bucket with your provider's tool) instead of step 2.
Check a dump is readable without restoring it: `docker compose exec -T postgres pg_restore -l < backup/sota-$stamp.dump | head`.

Without Docker: `pg_dump -Fc "$DATABASE_URL" > sota.dump` and `tar czf uploads.tgz -C "$STORAGE_DIR" .`.

## Restore

Onto a fresh machine, restore the `.env`, `compose.yml` and theme first. Then:

```bash
set -a; . ./.env; set +a
docker compose up -d postgres            # an empty database; the app is not running yet

# 1. Database. `with (force)` drops stray connections; skip the drop on a brand-new volume.
docker compose exec -T postgres psql -U "${POSTGRES_USER:-sota}" -d postgres \
  -c "drop database if exists ${POSTGRES_DB:-sota} with (force)" \
  -c "create database ${POSTGRES_DB:-sota}"
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-sota}" -d "${POSTGRES_DB:-sota}" \
  --no-owner --exit-on-error < backup/sota-2026-10-01.dump

# 2. Files into the (new) uploads volume. tar keeps the owner it recorded (the image runs as uid 1000).
docker volume create sota-prod_uploads
docker run --rm -v sota-prod_uploads:/data -v "$PWD/backup":/backup:ro alpine \
  tar xzf /backup/uploads-2026-10-01.tgz -C /data

# 3. Start the app: it applies any newer migrations on boot (a dump from an older release is upgraded).
docker compose up -d
curl -fsS http://localhost:3003/api/health
```

A dump restores into the same or a **newer** release, never an older one: migrations only go forward.
To go back, restore the dump taken before the upgrade and run the image you ran then.

## Restore drill

An untested backup is a hope. Once a quarter, and after changing how you back up, restore into a
scratch database and check it, without touching production:

1. Start a scratch Postgres of the same major version:
   `docker run -d --name sota-drill -e POSTGRES_USER=sota -e POSTGRES_PASSWORD=drill -p 5499:5432 postgres:16-alpine`.
2. Create a database and restore the latest dump into it (step 1 of _Restore_, with
   `docker exec -i sota-drill ...`).
3. Compare counts with production: `select count(*) from course` (and `lesson`, `person`, `enrollment`,
   `file`, `audit_log`), and `select count(*) from drizzle.__drizzle_migrations`.
4. Point a scratch copy of the app at it and prove it boots and serves content:
   `DATABASE_URL=postgres://sota:drill@localhost:5499/sota node scripts/sota.ts migrate` is a no-op, then
   `node scripts/sota.ts export ./drill-export --all` writes every course; open it (or diff it with an
   export from production).
5. Unpack the uploads archive into a scratch directory and compare checksums with the live volume.
6. Remove it: `docker rm -f sota-drill`; delete the scratch directories.

Record the date, the dump's age and how long the restore took. That time is your real recovery time.

## Export and import are not a backup

`pnpm sota export` / `import` (`docs/content-export-import.md`) move **content**: courses, lessons,
blocks, quizzes, assignments, optionally cohorts and drip dates, with their media. They deliberately
leave out people, enrollments, cohort members, submissions, quiz attempts, progress, forum posts, mail
queue and the audit log. Use them to copy a course between instances or to keep course material in git;
use the dump and the files for disaster recovery. A content export can be rebuilt into a working
catalogue, but nobody's progress comes back with it.
