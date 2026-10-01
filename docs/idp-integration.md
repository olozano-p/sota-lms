# Wiring your identity provider

With `AUTH_MODE=oidc` SOTA is an OIDC relying party (a better-auth generic OIDC client). Any
compliant provider works: better-auth with the OIDC Provider plugin (the reference), Keycloak,
Authentik, Auth0, Entra ID, Google Workspace… In this mode SOTA registers nobody, shows no local
login or signup, and takes people and roles from the IdP on every sign-in; the one exception is
the optional break-glass administrator (below). To run without an IdP use `AUTH_MODE=local`
(`docs/configuration.md`, ADR-013).

## What SOTA needs from you

| Setting                  | Value                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow                     | Authorization code with PKCE (S256). Confidential client.                                                                                                                                                                 |
| Redirect URI             | `{APP_URL}/api/auth/callback/oidc`                                                                                                                                                                                        |
| Post-logout redirect URI | `{APP_URL}/` (used when the discovery document has an `end_session_endpoint`, or `OIDC_END_SESSION_URL` is set)                                                                                                           |
| Scopes                   | `openid profile email` by default; `OIDC_SCOPES` overrides (add the scope that releases your roles or enrollment claim).                                                                                                  |
| Claims in the ID token   | `sub`, `email`, `name`; optionally `locale`; the roles claim (below). Claims missing from the ID token are fetched from the userinfo endpoint.                                                                            |
| Roles claim              | An array of strings among `student`, `teacher`, `admin` (`learner` and `instructor` are accepted as aliases; anything else is ignored). Name configurable with `OIDC_ROLES_CLAIM` (default `roles`). No claim = no roles. |
| Discovery                | `{OIDC_ISSUER}/.well-known/openid-configuration` must be reachable from the SOTA server.                                                                                                                                  |
| Token signing            | Asymmetric (RS256/ES256…) with a published JWKS and `issuer` in the discovery document: sign-in is refused otherwise. SOTA verifies signature, `iss`, `aud`, `exp` and `nonce`.                                           |
| Enrollment claim         | Optional. `ENTITLEMENT_CLAIM=enrollments` makes SOTA read `[{course, cohort?, until?}]` from that ID-token claim (see below).                                                                                             |

Set in `.env`: `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, optionally
`OIDC_SCOPES`, `OIDC_ROLES_CLAIM`, `OIDC_END_SESSION_URL` and `ENTITLEMENT_CLAIM` (all in
`docs/configuration.md`). The pull/webhook enrollment channel is separate:
`docs/entitlements-contract.md`.

## People: who is who

A person is keyed by issuer + `sub` (`person.external_iss`, `person.external_sub`) and
provisioned on first sign-in; name, email, locale and roles are refreshed on every sign-in. A
person the webhook or pull sync created earlier is adopted by matching email. The IdP is trusted
for the email address; an `email_verified: false` claim is recorded as unverified but does not
block sign-in. Roles are read from `person` on every request, so a change applies at once.

## Enrollments from the ID token

When `ENTITLEMENT_CLAIM` is set and the ID token carries that claim, each sign-in reconciles the
person's `claims` enrollments with it:

```json
{ "enrollments": [{ "course": "intro-1", "cohort": "autumn-26", "until": "2027-06-30T22:00:00Z" }] }
```

`course` and `cohort` are the slug or the `external_ref` an admin set on the course or cohort
(a cohort must belong to its course). Unknown references are logged and ignored; rows the claim
no longer lists become `expired`; a malformed claim changes nothing; a token without the claim
changes nothing. `manual` and `webhook` enrollments are never touched. If you also configure the
pull/webhook channel, both keep working side by side.

## Break-glass administrator

`BREAK_GLASS_ADMIN_EMAIL` (OIDC mode only) is the one address that may sign in with a password,
at `/login/break-glass` (not linked anywhere), for the day the IdP is down. Create it with
`pnpm create-admin --email <that address>`; the person must have the admin role. Every other
local-login, signup, magic-link, recovery and invitation endpoint is refused or not registered.

## The flow, as the user sees it

1. They open any SOTA page. Without a SOTA session they are redirected to your IdP.
2. If they already have a session there, the IdP redirects straight back — no visible login.
3. SOTA mirrors `sub`/`email`/`name`/`roles`/`locale` into `person`, reconciles their enrollments
   (claim and/or pull), opens a better-auth cookie session (12 h absolute, 2 h idle) and shows the
   page they asked for.
4. «Sign out» clears the SOTA session and, when the IdP advertises an end-session endpoint (or
   `OIDC_END_SESSION_URL` is set), sends them there with `id_token_hint` so they are signed out
   of both. The ID token is the only token SOTA keeps (for that hint).

Sharing the locale: set `COOKIE_DOMAIN=.example.org` and have the parent site write the same
cookie (`lms.config.ts → locales.cookieName`, default `sota_locale`), or link with `?lang=xx`.

## Worked example: better-auth with the OIDC Provider plugin

On the site that owns the users:

```ts
import { betterAuth } from "better-auth";
import { oidcProvider } from "better-auth/plugins";

export const auth = betterAuth({
  // …your database, email/password, social providers…
  plugins: [
    oidcProvider({
      loginPage: "/login",
      // Claims SOTA reads. `roles` comes from wherever you keep them (here a column on user).
      getAdditionalUserInfoClaim: (user) => ({
        roles:
          user.role === "admin" ? ["admin"] : user.role === "teacher" ? ["teacher"] : ["student"],
        locale: user.locale ?? "ca",
      }),
    }),
  ],
});
```

Register the client once (better-auth exposes a client-registration API or you insert the row):

```json
{
  "client_id": "sota",
  "client_secret": "…",
  "redirect_urls": ["https://learn.example.org/api/auth/callback/oidc"],
  "type": "web",
  "disabled": false,
  "skip_consent": true
}
```

Then in SOTA's `.env`:

```
OIDC_ISSUER=https://www.example.org/api/auth
OIDC_CLIENT_ID=sota
OIDC_CLIENT_SECRET=…
OIDC_END_SESSION_URL=          # leave empty unless the discovery document lacks end_session_endpoint
OIDC_ROLES_CLAIM=roles
```

`skip_consent: true` is what makes step 2 above invisible. If your plugin version has no
`getAdditionalUserInfoClaim`, put the roles in the userinfo response instead: SOTA falls back
to `/userinfo` for any claim the ID token lacks.

## Trying it without an IdP

`docker compose up` (or `pnpm mock-idp`) runs `dev/mock-idp/server.mjs`: a node-oidc-provider
instance with four users and the claims above, plus a mock enrollment source. The login page is
a list of buttons, and an `enrollments` ID-token claim for trying `ENTITLEMENT_CLAIM` (name set by
`MOCK_IDP_ENTITLEMENT_CLAIM`). Nothing in it is fit for production.

## Checklist for going live

- [ ] Redirect URI registered exactly as `{APP_URL}/api/auth/callback/oidc` (scheme and host included).
- [ ] Roles claim present for teachers and admins; a student has `["student"]` or no claim.
- [ ] `OIDC_ISSUER` matches the `iss` in the tokens byte for byte (trailing slash included).
- [ ] The SOTA server can reach the discovery document and the JWKS URL.
- [ ] `SESSION_SECRET` is ≥ 32 random bytes and `APP_URL` starts with `https://` (the session
      cookie is `Secure` only then).
