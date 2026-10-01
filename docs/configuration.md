# Configuration

Everything a deployment changes lives in the environment (`.env`, copied from `.env.example`) or in
`lms.config.ts` (brand, locales, upload limits, notification defaults; see its comments). This page
documents every environment variable.

The environment is parsed with Zod (`src/config/env.ts`) and validated at boot: `pnpm start`
(`scripts/serve.mjs`), `pnpm create-admin` and the first request in `pnpm dev` stop with one message
listing every problem. An empty value (`KEY=`) counts as unset.

## Core

| Variable             | Default                                    | Notes                                                                                                                                                                      |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`            | `http://localhost:$PORT`                   | Public origin, without a trailing slash. Used in links in mail, as the auth base URL and for CORS-style origin checks. `https://` makes cookies `Secure` and enables HSTS. |
| `PORT`               | `3003`                                     | Port of the Node server.                                                                                                                                                   |
| `DATABASE_URL`       | `postgres://sota:sota@localhost:5433/sota` | Postgres connection string. `pglite://memory` opens an in-memory database (tests only).                                                                                    |
| `SESSION_SECRET`     | dev value outside production               | **Required in production**, at least 32 characters (`openssl rand -base64 32`). Signs sessions, one-time links and storage tokens. Changing it signs everyone out.         |
| `DEFAULT_LOCALE`     | `lms.config.ts` → `locales.default`        | `ca`, `es` or `en`, used when `?lang`, the cookie, the IdP claim and `Accept-Language` give nothing. Ignored if the locale is not enabled in `lms.config.ts`.              |
| `COOKIE_DOMAIN`      | unset                                      | Widens the **locale** cookie to a parent domain (`.example.org`). The session cookie is always host-only.                                                                  |
| `TRUST_PROXY`        | `false`                                    | `true` behind a reverse proxy: the last `X-Forwarded-For` hop is the client address for rate limiting.                                                                     |
| `NOTIFY_INTERVAL_MS` | `900000`                                   | Interval of the notification tick run by `scripts/serve.mjs`; `0` when cron runs `pnpm notify`.                                                                            |

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

## Enrollment source (docs/entitlements-contract.md)

The variable names predate the `enrollment` model (ADR-014) and are kept.

| Variable                      | Default | Notes                                                                                       |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `ENTITLEMENTS_PULL_URL`       | unset   | `GET ${URL}/{sub}` on sign-in and when the 15-minute cache is stale. Unset: no pull.        |
| `ENTITLEMENTS_PULL_TOKEN`     | unset   | Bearer token for the pull. Both pull variables are needed for the pull to run.              |
| `ENTITLEMENTS_WEBHOOK_SECRET` | unset   | HMAC secret of `POST ${APP_URL}/api/webhooks/entitlements`. Unset: the webhook answers 401. |
| `ENTITLEMENTS_WRITE_URL`      | unused  | Reserved for write-back of manual enrollments.                                              |

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
