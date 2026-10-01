# Logs and health

## Logs

SOTA writes one JSON object per line: `debug` and `info` on stdout, `warn` and `error` on stderr, so
`docker compose logs app` is both the access log and the error log. `LOG_LEVEL` is `debug`, `info`
(default), `warn`, `error` or `silent`.

```json
{
  "time": "2026-10-01T10:15:02.114Z",
  "level": "info",
  "msg": "request",
  "requestId": "6f1c…",
  "method": "GET",
  "path": "/courses/intro",
  "status": 200,
  "durationMs": 23
}
```

- **Request log.** Every request handled by the application (not the static files under `/assets`)
  logs `requestId`, `method`, `path`, `status` and `durationMs` when it finishes. The path has no query
  string and token-bearing segments are masked (`/api/storage/:token`, `/api/v1/enrollments/:external_id`,
  `/api/v1/users/:sub/progress`). A request id sent by a reverse proxy in `X-Request-Id` (8 to 64 letters,
  digits, `.`, `_`, `-`) is reused, otherwise one is generated; the response carries it back in
  `X-Request-Id`, so a user's error report can be matched to a line. Health probes are logged at `debug`.
- **What is never logged.** Addresses of clients, headers, cookies, request bodies, e-mail addresses,
  tokens, passwords and signatures. Field names that usually carry one are replaced by `[redacted]`
  and free text (error messages) is scrubbed of addresses, bearer values, `token=` style query values and
  long hex strings. Errors are logged by name and scrubbed message, not by stack.
- **Other lines.** Startup (`listening`), `migrations applied`, the notification tick, failed mail
  deliveries, failed enrollment syncs, handler errors in the service API (`api/v1 handler failed`) and
  deprecated variables. Each has a short constant `msg` and structured fields, so `jq 'select(.level=="error")'`
  is enough to find trouble.
- **Command line.** `pnpm sota ...` and `create-admin` print plain text for the operator who runs them;
  only what runs unattended (migrations at container start, the notification tick) logs JSON.
- **Development mail.** `MAIL_TRANSPORT=console` prints whole messages (including one-time links)
  to stdout so that you can click them locally. It is the one place that is not scrubbed; use `smtp`
  wherever real mail flows.

Ship the output wherever the rest of your logs go (Docker's `json-file` driver with rotation, journald,
a log collector). The application keeps no log files.

## Health

`GET /api/health` (alias `GET /api/v1/health`), no authentication, subject to the
normal /api rate limit:

```json
{ "status": "ok", "version": "1.0.0", "db": "ok", "dbLatencyMs": 3 }
```

`200` when `select 1` returns within three seconds. Otherwise `503` with `"status": "degraded"` and
`"db": "unreachable"` (`dbLatencyMs` then says how long the attempt took, three seconds on a timeout).
`version` is the `package.json` version of the running build. The image's `HEALTHCHECK` and a reverse
proxy or uptime monitor should use the status code; alert on `dbLatencyMs` if you want an early warning.
The endpoint does not check the storage backend or the mail server: a failing upload or message shows
up as an `error` or `warn` line.
