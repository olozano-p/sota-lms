# ADR-017 · Local mode guards: signup, first admin, invitations, account mail

**Date** 2026-10-01 · **Status** accepted · implements ADR-013

## Decision

- **Signup is gated in a database hook, not in the form.** `ALLOW_SIGNUP` (or the absence of any
  admin) decides whether `/sign-up/email` and a magic link for an unknown address may create a
  person; a person created that way is `student`, or `admin` when no admin exists yet. The hook only
  looks at the endpoint path, so internal creation (invitations, `create-admin`, OIDC provisioning)
  is unaffected. The "first user is admin" rule is a bootstrap convenience with a known race (two
  simultaneous first sign-ups); `pnpm create-admin` is the deliberate path and the docs say to run it
  before exposing a fresh deployment.
- **Email is confirmed before a password account works** (`requireEmailVerification`). Without it,
  someone could register a victim's address with their own password and keep it after the victim
  later signs in by magic link. Invitations and magic links verify the address by construction.
- **No account enumeration.** With verification required, the library answers a sign-up for a
  closed or existing address exactly like a successful one; a magic link request for an unknown
  address while signup is closed returns success and sends nothing.
- **Invitations are our own table**, not password-reset tokens: they live 7 days (reset links one
  hour), carry the roles and name the admin chose, show up as pending in the admin UI, and only the
  SHA-256 of the token is stored. Redeeming one is a better-auth plugin endpoint
  (`/api/auth/invite/accept`) so the session cookie is set by the library; the plugin is registered
  in `local` mode only.
- **Account mail rides the notification queue** (`notification.to_email`, `person_id` nullable,
  check constraint) because its recipient may not have a person row yet. It is flushed immediately
  after enqueueing (a link that arrives at the next 15-minute tick is useless), ignores
  `notifications.enabled` and opt-outs, never enters a digest, and its payload (a live one-time
  link) is overwritten once sent.
- **OIDC mode removes rather than hides.** The magic-link and invitation plugins are not registered;
  sign-up is disabled; a before-hook refuses password sign-in for every address except
  `BREAK_GLASS_ADMIN_EMAIL` and a session hook refuses it for a break-glass person who is not an
  admin. The UI routes return 404 in the wrong mode.
- **Rate limits** for credential, magic-link, recovery and invitation endpoints are 10 per minute per
  client in one shared bucket (`src/start.ts` middleware, `AUTH_SENSITIVE_PREFIXES`), on top of
  better-auth's own limiter.

## Consequences

- With `MAIL_TRANSPORT=console` (the default) confirmation and magic links appear in the server log:
  fine for development and for a first admin, not for a public signup, which needs SMTP.
- Per-address throttling of magic-link mail is not implemented; the per-client bucket and the
  library's per-endpoint limiter are the only brakes.
