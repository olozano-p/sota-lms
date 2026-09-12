/**
 * Development identity provider + entitlement source, so a contributor can run the full flow
 * without any real IdP. Plain Node, no build step.
 *
 *   node dev/mock-idp/server.mjs      (or `pnpm mock-idp`, or the `mock-idp` compose service)
 *
 * - OIDC provider (node-oidc-provider) at http://localhost:3013 with three users. The login
 *   page is a list of buttons: pick who you are. Claims: sub, email, name, locale, roles.
 * - Entitlement source: GET /entitlements/v1/:sub (Bearer token) returns the entitlements/v1
 *   payload for that user; POST /push/:sub signs and pushes the same payload to the LMS webhook.
 * - GET / shows the users and a "push" button per user for the webhook demo.
 */
import { createHmac, randomUUID } from "node:crypto";
import Provider from "oidc-provider";

const PORT = Number(process.env.MOCK_IDP_PORT ?? 3013);
const ISSUER = process.env.MOCK_IDP_ISSUER ?? `http://localhost:${PORT}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3003";
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "sota";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "sota-dev-secret";
const PULL_TOKEN = process.env.ENTITLEMENTS_PULL_TOKEN ?? "sota-dev-pull-token";
const WEBHOOK_SECRET = process.env.ENTITLEMENTS_WEBHOOK_SECRET ?? "sota-dev-webhook-secret";

/** The three seeded people. `entitlements` follow docs/entitlements-contract.md. */
export const USERS = {
  student: {
    sub: "mock-student",
    email: "student@example.invalid",
    name: "Aina Estudiant",
    locale: "ca",
    roles: ["student"],
    entitlements: [
      { scope: "course", ref: "introduccio-a-la-contemplacio", rule: "immediate", until: null },
      { scope: "cohort", ref: "tardor-2026", rule: "immediate", until: null },
    ],
  },
  delayed: {
    sub: "mock-delayed",
    email: "delayed@example.invalid",
    name: "Pau Pacient",
    locale: "es",
    roles: ["student"],
    entitlements: [{ scope: "all_courses", ref: null, rule: "delayed", until: "2027-12-31" }],
  },
  teacher: {
    sub: "mock-teacher",
    email: "teacher@example.invalid",
    name: "Marta Mestra",
    locale: "ca",
    roles: ["teacher"],
    entitlements: [{ scope: "all_courses", ref: null, rule: "immediate", until: null }],
  },
  admin: {
    sub: "mock-admin",
    email: "admin@example.invalid",
    name: "Oriol Administrador",
    locale: "en",
    roles: ["admin"],
    entitlements: [{ scope: "all_courses", ref: null, rule: "immediate", until: null }],
  },
};

const bySub = Object.fromEntries(Object.values(USERS).map((u) => [u.sub, u]));

function payloadFor(user) {
  return {
    version: "entitlements/v1",
    sub: user.sub,
    email: user.email,
    name: user.name,
    locale: user.locale,
    roles: user.roles,
    entitlements: user.entitlements,
  };
}

const provider = new Provider(ISSUER, {
  clients: [
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uris: [`${APP_URL}/auth/callback`],
      post_logout_redirect_uris: [APP_URL, `${APP_URL}/`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  pkce: { required: () => true },
  claims: {
    openid: ["sub"],
    profile: ["name", "locale", "roles"],
    email: ["email", "email_verified"],
  },
  features: {
    devInteractions: { enabled: false },
    rpInitiatedLogout: { enabled: true, logoutSource, postLogoutSuccessSource },
  },
  cookies: { keys: ["mock-idp-cookie-key"] },
  ttl: {
    Session: 60 * 60 * 12,
    Interaction: 600,
    AccessToken: 3600,
    AuthorizationCode: 60,
    IdToken: 3600,
    Grant: 60 * 60 * 12,
  },
  async findAccount(_ctx, sub) {
    const user = bySub[sub];
    if (!user) return undefined;
    return {
      accountId: sub,
      async claims() {
        return {
          sub,
          email: user.email,
          email_verified: true,
          name: user.name,
          locale: user.locale,
          roles: user.roles,
        };
      },
    };
  },
  // Every claim always in the ID token: the RP reads `roles` and `locale` from it.
  conformIdTokenClaims: false,
  async loadExistingGrant(ctx) {
    const grantId =
      ctx.oidc.result?.consent?.grantId || ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
    if (grantId) return ctx.oidc.provider.Grant.find(grantId);
    const grant = new ctx.oidc.provider.Grant({
      clientId: ctx.oidc.client.clientId,
      accountId: ctx.oidc.session.accountId,
    });
    grant.addOIDCScope("openid profile email");
    grant.addOIDCClaims(["sub", "email", "email_verified", "name", "locale", "roles"]);
    await grant.save();
    return grant;
  },
  interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
});
provider.proxy = true;

async function logoutSource(ctx, form) {
  ctx.body = page(
    "Sign out",
    `<p>Sign out of the mock identity provider?</p>${form}<button autofocus type="submit" form="op.logoutForm" value="yes" name="logout">Yes, sign out</button>`,
  );
}
async function postLogoutSuccessSource(ctx) {
  ctx.body = page("Signed out", `<p>Signed out. <a href="${APP_URL}">Back to the app</a></p>`);
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · mock IdP</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f6f4ef;color:#1e1c19;max-width:36rem;margin:3rem auto;padding:0 1rem}h1{font-weight:500}button,.btn{display:block;width:100%;text-align:left;margin:.5rem 0;padding:.75rem 1rem;border:1px solid rgba(30,28,25,.2);border-radius:4px;background:#fdfcf9;font:inherit;cursor:pointer}button:hover{background:rgba(30,28,25,.05)}small{color:#6b665e}code{background:rgba(30,28,25,.06);padding:.1em .3em;border-radius:3px}</style></head>
<body><h1>${title}</h1>${body}<p><small>dev/mock-idp — not for production</small></p></body></html>`;
}

function userList(action) {
  return Object.values(USERS)
    .map(
      (u) =>
        `<form method="post" action="${action}"><input type="hidden" name="sub" value="${u.sub}"><button type="submit"><strong>${u.name}</strong><br><small>${u.email} · roles: ${u.roles.join(", ")} · locale: ${u.locale}</small></button></form>`,
    )
    .join("");
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** Everything that is not the OIDC protocol: login UI, entitlement pull, webhook push, index. */
async function extra(req, res) {
  const url = new URL(req.url, ISSUER);

  if (url.pathname === "/" && req.method === "GET") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      page(
        "Mock identity provider",
        `<p>Issuer <code>${ISSUER}</code> · client <code>${CLIENT_ID}</code> · app <code>${APP_URL}</code></p>
         <h2>Push entitlements to the LMS webhook</h2>${userList("/push")}
         <h2>Pull endpoint</h2><p><code>GET /entitlements/v1/{sub}</code> with <code>Authorization: Bearer ${PULL_TOKEN}</code></p>`,
      ),
    );
    return true;
  }

  const interaction = url.pathname.match(/^\/interaction\/([^/]+)$/);
  if (interaction) {
    const details = await provider.interactionDetails(req, res);
    if (req.method === "GET") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        page(
          "Who are you?",
          `<p>Signing in to <code>${details.params.client_id}</code>. Pick a user:</p>${userList(`/interaction/${interaction[1]}`)}`,
        ),
      );
      return true;
    }
    if (req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const sub = form.get("sub");
      if (!bySub[sub]) {
        res.statusCode = 400;
        res.end("unknown user");
        return true;
      }
      await provider.interactionFinished(
        req,
        res,
        { login: { accountId: sub, remember: true } },
        { mergeWithLastSubmission: false },
      );
      return true;
    }
  }

  const pull = url.pathname.match(/^\/entitlements\/v1\/([^/]+)$/);
  if (pull && req.method === "GET") {
    if (req.headers.authorization !== `Bearer ${PULL_TOKEN}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return true;
    }
    const user = bySub[decodeURIComponent(pull[1])];
    res.setHeader("content-type", "application/json");
    if (!user) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
      return true;
    }
    res.end(JSON.stringify(payloadFor(user)));
    return true;
  }

  if (url.pathname === "/push" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const user = bySub[form.get("sub")];
    if (!user) {
      res.statusCode = 400;
      res.end("unknown user");
      return true;
    }
    const body = JSON.stringify(payloadFor(user));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    let result;
    try {
      const r = await fetch(`${APP_URL}/api/webhooks/entitlements`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": timestamp,
          "x-signature": signature,
          "x-event-id": randomUUID(),
        },
        body,
      });
      result = `${r.status} ${await r.text()}`;
    } catch (e) {
      result = `failed: ${e.message}`;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      page(
        "Pushed",
        `<p>Webhook for <strong>${user.name}</strong> → <code>${result}</code></p><p><a href="/">Back</a></p><pre>${body}</pre>`,
      ),
    );
    return true;
  }

  return false;
}

const callback = provider.callback();
const server = (await import("node:http")).createServer(async (req, res) => {
  try {
    if (await extra(req, res)) return;
    callback(req, res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end("mock-idp error");
  }
});
server.listen(PORT, () => console.log(`mock IdP listening on ${ISSUER} (app: ${APP_URL})`));
