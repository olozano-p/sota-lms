# Configuration

Everything a deployment changes lives in the environment (`.env`, copied from `.env.example`) or in
`lms.config.ts` (enabled locales, time zone, upload limits, notification defaults; see its comments) or
the theme directory (name, logo, colours, fonts, default language, copy, mail layout: `docs/theming.md`). This page
documents every environment variable.

The environment is parsed with Zod (`src/config/env.ts`) and validated at boot: `pnpm start`
(`scripts/serve.mjs`), `pnpm create-admin` and the first request in `pnpm dev` stop with one message
listing every problem. An empty value (`KEY=`) counts as unset.

## Core

| Variable             | Default                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_URL`            | `http://localhost:$PORT`                   | Public origin, without a trailing slash. Used in links in mail, as the auth base URL and for CORS-style origin checks. `https://` makes cookies `Secure` and enables HSTS.                                                                                                                                                                                                                                               |
| `PORT`               | `3003`                                     | Port of the Node server.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DATABASE_URL`       | `postgres://sota:sota@localhost:5433/sota` | Postgres connection string. `pglite://memory` opens an in-memory database (tests only).                                                                                                                                                                                                                                                                                                                                  |
| `SESSION_SECRET`     | dev value outside production               | **Required in production**, at least 32 characters (`openssl rand -base64 32`). Signs sessions, one-time links and storage tokens. Changing it signs everyone out.                                                                                                                                                                                                                                                       |
| `DEFAULT_LOCALE`     | theme `defaultLocale` (`ca`)               | `ca`, `es` or `en`, used when `?lang`, the cookie, the IdP claim and `Accept-Language` give nothing. Wins over `theme.json`; ignored if the locale is not enabled in `lms.config.ts`.                                                                                                                                                                                                                                    |
| `THEME_DIR`          | `./theme`                                  | Theme directory (`theme.json`, `custom.css`, `messages/`, `emails/`, `assets/`, `slots/`). Unset: `./theme` when it exists, else the shipped look; set and missing is an error. Read at boot and checked by `pnpm sota validate-theme`. Slots are compiled in at **build** time from the directory the build sees (`docker build --build-arg THEME_DIR=...`); everything else is read at runtime. See `docs/theming.md`. |
| `LOG_LEVEL`          | `info`                                     | `debug`, `info`, `warn`, `error` or `silent`. Structured JSON logs, one object per line (`docs/observability.md`).                                                                                                                                                                                                                                                                                                       |
| `COOKIE_DOMAIN`      | unset                                      | Widens the **locale** cookie to a parent domain (`.example.org`). The session cookie is always host-only.                                                                                                                                                                                                                                                                                                                |
| `TRUST_PROXY`        | `false`                                    | `true` behind a reverse proxy: the last `X-Forwarded-For` hop is the client address for rate limiting.                                                                                                                                                                                                                                                                                                                   |
| `NOTIFY_INTERVAL_MS` | `900000`                                   | Interval of the notification tick run by `scripts/serve.mjs`; `0` when cron runs `pnpm notify`.                                                                                                                                                                                                                                                                                                                          |

## Authentication (ADR-013, ADR-016)

| Variable                  | Default                | Notes                                                                                                                                                                                                        |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_MODE`               | `local`                | `local` or `oidc`.                                                                                                                                                                                           |
| `ALLOW_SIGNUP`            | `false`                | `local` only. `true` lets anyone register (email confirmation required). `false`: people arrive by admin invitation. Ignored in `oidc` mode.                                                                 |
| `BREAK_GLASS_ADMIN_EMAIL` | unset                  | `oidc` only. The one address allowed to sign in with a password, at `/login/break-glass`, when the IdP is down. The person must be an admin; create them with `pnpm create-admin`. Rejected in `local` mode. |
| `OIDC_ISSUER`             | -                      | **Required with `AUTH_MODE=oidc`.** Issuer URL; `${OIDC_ISSUER}/.well-known/openid-configuration` must be reachable from the server and publish `issuer` and `jwks_uri`.                                     |
| `OIDC_CLIENT_ID`          | -                      | **Required with `oidc`.** Confidential client; authorization code + PKCE, secret sent with HTTP Basic.                                                                                                       |
| `OIDC_CLIENT_SECRET`      | -                      | **Required with `oidc`.**                                                                                                                                                                                    |
| `OIDC_SCOPES`             | `openid profile email` | Space or comma separated.                                                                                                                                                                                    |
| `OIDC_ROLES_CLAIM`        | `roles`                | Claim (ID token, else userinfo) with the roles array: `student`, `teacher`, `admin`; `learner` and `instructor` are accepted aliases.                                                                        |
| `OIDC_END_SESSION_URL`    | unset                  | Overrides the discovery document's `end_session_endpoint` for RP-initiated logout.                                                                                                                           |
| `ENTITLEMENT_CLAIM`       | unset                  | `oidc` only. Name of the ID-token claim carrying `[{course, cohort?, until?}]`; each sign-in reconciles the person's `claims` enrollments (`docs/idp-integration.md`).                                       |

In `local` mode people sign in with email + password or a magic link, are invited by admins
(`/admin/people`), and the first account is an admin: `pnpm create-admin` creates it explicitly; until
an administrator exists, the first sign-up becomes one even with `ALLOW_SIGNUP=false`, so create the admin
before exposing a fresh deployment. In `oidc` mode no login, signup, magic-link, recovery or
invitation endpoint exists.

Account mail (magic link, confirmation, password reset, invitation) goes through the same mail queue as
notifications and is flushed immediately; with `MAIL_TRANSPORT=console` the link is printed to the server log.

## Enrollment source and service API (docs/entitlements-contract.md, docs/integration.md)

| Variable                      | Default | Notes                                                                                                                                                                                                                  |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_SERVICE_TOKEN`           | unset   | Bearer token of the service API (`/api/v1`), at least 16 characters (`openssl rand -hex 32`). Unset or empty: the API is off and every route except `/api/v1/health` answers 404.                                      |
| `WEBHOOK_HMAC_SECRET`         | unset   | Signing secret. When set, every authenticated `/api/v1` call needs `X-Timestamp` and `X-Signature`, and `POST /api/webhooks/entitlements` is accepted (unset: it answers 401). Signature rules: `docs/integration.md`. |
| `ENTITLEMENT_CLAIM`           | unset   | See Authentication above: enrollments carried by the ID token.                                                                                                                                                         |
| `ENTITLEMENTS_PULL_URL`       | unset   | `GET ${URL}/{sub}` on sign-in and when the 15-minute cache is stale. Unset: no pull. The variable names predate the `enrollment` model (ADR-014) and are kept.                                                         |
| `ENTITLEMENTS_PULL_TOKEN`     | unset   | Bearer token for the pull. Both pull variables are needed for the pull to run.                                                                                                                                         |
| `ENTITLEMENTS_WEBHOOK_SECRET` | unset   | **Deprecated** alias of `WEBHOOK_HMAC_SECRET`, read only when that is unset; a boot warning names it (ADR-020).                                                                                                        |
| `ENTITLEMENTS_WRITE_URL`      | unused  | Reserved for write-back of manual enrollments.                                                                                                                                                                         |

The complete-set channels (pull, `POST /api/webhooks/entitlements`) and the service API both write
`webhook` enrollments; do not use both for the same people (ADR-020).

## Storage

| Variable               | Default        | Notes                                                                                         |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`       | `local`        | `local` or `s3`.                                                                              |
| `STORAGE_DIR`          | `data/uploads` | `local` only. **Required in production**; must survive deploys. Resolved to an absolute path. |
| `S3_BUCKET`            | -              | **Required with `s3`.** Private bucket.                                                       |
| `S3_ACCESS_KEY_ID`     | -              | **Required with `s3`.**                                                                       |
| `S3_SECRET_ACCESS_KEY` | -              | **Required with `s3`.**                                                                       |
| `S3_ENDPOINT`          | AWS            | Any S3 API.                                                                                   |
| `S3_PUBLIC_ENDPOINT`   | `S3_ENDPOINT`  | Origin browsers use when it differs from the server's.                                        |
| `S3_REGION`            | `us-east-1`    |                                                                                               |
| `S3_FORCE_PATH_STYLE`  | `false`        |                                                                                               |

## Mail

| Variable         | Default                      | Notes                                       |
| ---------------- | ---------------------------- | ------------------------------------------- |
| `MAIL_TRANSPORT` | `console`                    | `console` logs messages; `smtp` sends them. |
| `MAIL_FROM`      | `SOTA <lms@example.invalid>` | Sender address.                             |
| `SMTP_HOST`      | -                            | **Required with `smtp`.**                   |
| `SMTP_PORT`      | `587`                        |                                             |
| `SMTP_SECURE`    | `false`                      | `true` for implicit TLS (port 465).         |
| `SMTP_USER`      | unset                        | With `SMTP_PASSWORD`.                       |
| `SMTP_PASSWORD`  | unset                        |                                             |

## Other

| Variable             | Default | Notes                                                                  |
| -------------------- | ------- | ---------------------------------------------------------------------- |
| `VIMEO_ACCESS_TOKEN` | unset   | Token with `private` + `video_files` scopes, to validate Vimeo videos. |

`NODE_ENV=production` (set by the Docker image) switches on the production requirements above and the
strict CSP. `FORCE_DIGEST=true` is read only by `pnpm notify`. The mock IdP in `dev/mock-idp` reads its own
`MOCK_IDP_*` variables (`MOCK_IDP_PORT`, `MOCK_IDP_ISSUER`, `MOCK_IDP_ENTITLEMENT_CLAIM`).

## `lms.config.ts` and the theme

`lms.config.ts` holds the non-visual, non-secret settings: `locales.enabled` and `locales.cookieName`,
`timeZone`, `embedAllowlist`, `uploads`, `notifications`, `forum`. It does not hold anything an
organisation would call its look: since Phase 3 the keys `brand` (name, logo, colours, project link),
`contactEmail` (now `supportEmail`) and `locales.default` (now `defaultLocale`) live in
`theme/theme.json`. A fork that still sets them fails at boot with a message naming the new place.

The theme directory is `THEME_DIR`; `pnpm sota validate-theme` checks it and `pnpm sota validate-config`
summarises it. Fields, slots, mail templates and the build-time/runtime split: `docs/theming.md`.

## Container and Compose

Read by the image's start command, `compose.yml` or a single command, not by the application.

| Variable            | Default                     | Notes                                                                                                                              |
| ------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SOTA_IMAGE`        | `ghcr.io/OWNER/sota:latest` | The image Compose runs. `OWNER` is a placeholder: use the account that published the release (`docs/deploying.md`) or a local tag. |
| `HOST_PORT`         | `3003`                      | Port published on `127.0.0.1` by `compose.yml`.                                                                                    |
| `POSTGRES_USER`     | `sota`                      | Database user of the bundled Postgres; `compose.yml` builds `DATABASE_URL` from these three.                                       |
| `POSTGRES_PASSWORD` | **required**                | Database password. Compose refuses to start without it.                                                                            |
| `POSTGRES_DB`       | `sota`                      | Database name.                                                                                                                     |
| `MIGRATE`           | `true`                      | The image applies migrations before it starts the server; `false` skips them (run `node scripts/sota.ts migrate` yourself).        |
| `SEED`              | `false`                     | `true` loads the demo course, cohort and mock-IdP users at start (development only).                                               |
| `ADMIN_PASSWORD`    | prompt                      | Read by `create-admin` instead of prompting, for scripted setups (`docs/deploying.md`).                                            |
| `FORCE_DIGEST`      | unset                       | `true` makes `pnpm notify` send the daily digest now.                                                                              |

`STORAGE_DIR` defaults to `/app/data/uploads` inside the image (the directory that is writable there), so a volume mounted at that path is all
`STORAGE_DRIVER=local` needs.

## Built-in limits

An in-process token bucket per client address (a fallback behind the reverse proxy's own limits;
behind a proxy set `TRUST_PROXY=true`, otherwise every client looks like the proxy). Over the limit a
request gets `429` with `Retry-After: 60`. The counters live in memory and start empty on a restart.

| Paths                                                                                                                                            | Per minute | Bucket                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------- |
| `/api/auth/` sign-in by email, sign-up, magic link (request and verify), password reset and change, e-mail verification, `invite/*`, delete user | 10         | one shared bucket per client    |
| other `/api/auth/` (session, sign-out, OIDC callback)                                                                                            | 120        | per client                      |
| `/auth/`                                                                                                                                         | 60         | per client                      |
| `/api/storage/` (signed file transfer)                                                                                                           | 600        | per client                      |
| `/api/v1/` (service API)                                                                                                                         | 300        | per client, apart from the rest |
| `/api/webhooks/` (complete-set push channel)                                                                                                     | 60         | per client                      |
| `/_serverFn/` (every admin and teacher action)                                                                                                   | 600        | per client                      |
| other `/api/`                                                                                                                                    | 240        | per client                      |

Account mail (magic link, verification, password reset, invitation) is throttled **per address**:
at most five messages an hour to one address, whoever asks. The magic-link endpoint answers as usual
and sends nothing past the limit (it never reveals whether an address is known); an invitation past the
limit is still created and the admin is told that no mail was queued (`mailQueued: false`, also in
the `person.invite` audit row), so it can be resent later or the link shared by other means.
