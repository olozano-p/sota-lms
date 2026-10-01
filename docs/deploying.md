# Deploying SOTA from scratch

This is the shortest path from nothing to a running school: one machine with Docker, a
`compose.yml` and a `.env`. No identity provider, no mail server and no cloud account are needed
to start. By the end you have an administrator, a published course and a learner who has finished it.

`docs/deploy.md` is the reference (reverse proxy, S3, backups, the non-Docker option); this page is
the walkthrough. It was followed end to end against an empty database before it was written down.

## What you need

- Docker with the Compose plugin (`docker compose version`).
- Two files in an empty directory: `compose.yml` (copy it from the repository root) and the `.env`
  below. Nothing else.
- The SOTA image. The default in `compose.yml` is `ghcr.io/olozano-p/sota-lms:latest`; until a
  release is published there, build it once from a checkout and point Compose at it:

  ```bash
  docker build -t sota:local /path/to/sota-lms
  export SOTA_IMAGE=sota:local
  ```

## 1. Write the `.env`

```bash
mkdir sota && cd sota
cp /path/to/sota-lms/compose.yml .
cat > .env <<EOF
APP_URL=http://localhost:3003
SESSION_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
EOF
```

That is the whole required configuration. Everything else has a default (`docs/configuration.md`
lists every variable). Things you will want to change before real people use it:

| Variable                         | Why                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `APP_URL`                        | The public address, `https://learn.example.org` behind your proxy. It is used in every link in an email. |
| `MAIL_TRANSPORT=smtp` + `SMTP_*` | With the default `console`, invitation and sign-in links are only printed to the log (step 5 uses that). |
| `TRUST_PROXY=true`               | Only when a reverse proxy you control is in front, so rate limiting sees the client address.             |
| `HOST_PORT`                      | The port published on `127.0.0.1` (default 3003).                                                        |

`AUTH_MODE` defaults to `local`: people sign in with email and password or a magic link, and are
invited by an administrator. To delegate sign-in to your identity provider set `AUTH_MODE=oidc`
and the `OIDC_*` variables instead (`docs/idp-integration.md`).

## 2. Start it

```bash
docker compose up -d
curl http://localhost:3003/api/health      # {"status":"ok","db":"ok"}
docker compose exec app node scripts/sota.ts validate-config
```

The app applies its migrations on every start and never seeds demo data unless you set
`SEED=true`. `validate-config` prints what it understood (mode, storage, mail) and warns about
settings that are fine for a try-out but wrong for a public server.

## 3. Create the administrator

```bash
docker compose exec app node scripts/sota.ts create-admin --email you@example.org --name "Your Name"
```

It asks for a password (at least 10 characters). To pass it non-interactively add
`-e ADMIN_PASSWORD=...` after `exec`. Do this before exposing the server: until an administrator
exists, the first person to sign up becomes one.

Open http://localhost:3003 and sign in.

## 4. Create and publish a course

1. **Teach** (top navigation) → _New course_: a title and the content language.
2. In the course editor add a chapter, then a lesson in it, and open the lesson.
3. _Add_ a text block and write something. Blocks save themselves; _Publish_ the lesson.
4. **Settings** tab → set _Status_ to _Published_. A draft course is invisible to learners.

## 5. Enroll a learner

1. **Enrollments** tab of the course. Paste one address or a list (one per line, or separated by
   commas) and press _Enroll_.
2. In `local` mode an unknown address gets an invitation. With `MAIL_TRANSPORT=console` the link is
   in the log: `docker compose logs app | grep accept-invite`. With SMTP the learner receives it.
3. The learner opens the link, picks a name and a password, and lands on **My courses** with the
   course in it. (In `oidc` mode no invitation is sent: the address becomes a placeholder, and the
   enrollment is waiting for them the first time they sign in through the IdP.)

To enroll a whole group at once, create a **cohort** (Cohorts tab), add its members and use
_Enroll the whole cohort_. The same page has the drip rule: "one chapter every N days from the
start date" writes the release dates, which you can still edit one by one.

## 6. The learner finishes the course

The learner opens the course, reads the lesson and presses _Mark as done_. **My courses** now shows
`1 of 1 lessons · 100%`. Assignments and self-checks work the same way: they are blocks inside a
lesson, and an instructor reviews submissions under the course's **Submissions** tab (filterable
by cohort).

## Customising

- **Brand, languages, time zone, upload limits**: copy `lms.config.ts` next to `compose.yml`, edit
  it and uncomment its volume line in `compose.yml`.
- **Theme folder**: `compose.yml` has a commented-out mount for `./theme` at `/app/theme`. The
  folder is reserved for the theming phase: nothing reads it yet, and
  `node scripts/sota.ts validate-theme` says so.
- **Files** are in the `uploads` volume; with `STORAGE_DRIVER=s3` use any private S3-compatible bucket.

## Operating it

| Task                    | Command                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Upgrade                 | `docker compose pull && docker compose up -d` (migrations run on start)                      |
| Logs                    | `docker compose logs -f app`                                                                 |
| Another administrator   | `docker compose exec app node scripts/sota.ts create-admin --email ...`                      |
| Check the configuration | `docker compose exec app node scripts/sota.ts validate-config`                               |
| Back up                 | `docker compose exec postgres pg_dump -U sota -Fc sota > sota.dump` and the `uploads` volume |

In a checkout the same commands are `pnpm sota <command>`.
