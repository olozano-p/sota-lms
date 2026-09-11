# Wiring your identity provider

Lodrö is an OIDC relying party. Any compliant provider works: better-auth with the OIDC Provider
plugin (the reference), Keycloak, Authentik, Auth0, Entra ID, Google Workspace… Lodrö never
stores passwords, never registers users and has no role management: all of that is the IdP's.

## What Lodrö needs from you

| Setting                  | Value                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow                     | Authorization code with PKCE (S256). Confidential client.                                                                                      |
| Redirect URI             | `{APP_URL}/auth/callback`                                                                                                                      |
| Post-logout redirect URI | `{APP_URL}/` (only if you set `OIDC_END_SESSION_URL`)                                                                                          |
| Scopes                   | `openid profile email`                                                                                                                         |
| Claims in the ID token   | `sub`, `email`, `name`; optionally `locale`; the roles claim (below). Claims missing from the ID token are fetched from the userinfo endpoint. |
| Roles claim              | An array of strings among `student`, `teacher`, `admin`. Name configurable with `OIDC_ROLES_CLAIM` (default `roles`). No claim = student.      |
| Discovery                | `{OIDC_ISSUER}/.well-known/openid-configuration` must be reachable from the Lodrö server.                                                      |
| Token signing            | Asymmetric (RS256/ES256…) with a published JWKS. Lodrö verifies `iss`, `aud`, `exp`, `nonce`, tolerating 60 s of skew.                         |

Set in `.env`: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, optionally
`OIDC_END_SESSION_URL` and `OIDC_ROLES_CLAIM`. The entitlement side is separate:
`docs/entitlements-contract.md`.

## The flow, as the user sees it

1. They open any Lodrö page. Without a Lodrö session they are redirected to your IdP.
2. If they already have a session there, the IdP redirects straight back — no visible login.
3. Lodrö mirrors `sub`/`email`/`name`/`roles`/`locale` into `person`, pulls their entitlements,
   opens its own cookie session (12 h absolute, 2 h idle) and shows the page they asked for.
4. «Sign out» clears the Lodrö session and, if `OIDC_END_SESSION_URL` is set, sends them to the
   IdP's end-session endpoint with `id_token_hint` so they are signed out of both.

Sharing the locale: set `COOKIE_DOMAIN=.example.org` and have the parent site write the same
cookie (`lms.config.ts → locales.cookieName`, default `lodro_locale`), or link with `?lang=xx`.

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
      // Claims Lodrö reads. `roles` comes from wherever you keep them (here a column on user).
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
  "client_id": "lodro",
  "client_secret": "…",
  "redirect_urls": ["https://learn.example.org/auth/callback"],
  "type": "web",
  "disabled": false,
  "skip_consent": true
}
```

Then in Lodrö's `.env`:

```
OIDC_ISSUER=https://www.example.org/api/auth
OIDC_CLIENT_ID=lodro
OIDC_CLIENT_SECRET=…
OIDC_END_SESSION_URL=          # better-auth's plugin has no end-session endpoint yet; leave empty
OIDC_ROLES_CLAIM=roles
```

`skip_consent: true` is what makes step 2 above invisible. If your plugin version has no
`getAdditionalUserInfoClaim`, put the roles in the userinfo response instead: Lodrö falls back
to `/userinfo` for any claim the ID token lacks.

## Trying it without an IdP

`docker compose up` (or `pnpm mock-idp`) runs `dev/mock-idp/server.mjs`: a node-oidc-provider
instance with four users and the claims above, plus a mock entitlement source. The login page is
a list of buttons. Nothing in it is fit for production.

## Checklist for going live

- [ ] Redirect URI registered exactly as `{APP_URL}/auth/callback` (scheme and host included).
- [ ] Roles claim present for teachers and admins; a student has `["student"]` or no claim.
- [ ] `OIDC_ISSUER` matches the `iss` in the tokens byte for byte (trailing slash included).
- [ ] The Lodrö server can reach the discovery document and the JWKS URL.
- [ ] `SESSION_SECRET` is ≥ 32 random bytes and `APP_URL` starts with `https://` (the session
      cookie is `Secure` only then).
