/**
 * A minimal in-process OIDC provider for tests: discovery, JWKS, RS256 ID tokens, a userinfo
 * endpoint and a one-click authorize step that issues whatever claims `setClaims` last set.
 */
import { createServer, type Server } from "node:http";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

export function createFakeIdp(client = { id: "sota", secret: "sota-test-secret" }) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const b64 = (v: unknown) =>
    Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  function signJwt(payload: Record<string, unknown>) {
    const head = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
    const body = b64(payload);
    const sig = createSign("RSA-SHA256")
      .update(`${head}.${body}`)
      .sign(keys.privateKey)
      .toString("base64url");
    return `${head}.${body}.${sig}`;
  }

  /** The claims the fake IdP issues on the next sign-in. */
  let nextClaims: Record<string, unknown> = {};
  const codes = new Map<string, { nonce: string; claims: Record<string, unknown> }>();
  let issuer = "";
  let server: Server | null = null;

  function handle(): Server {
    return createServer((req, res) => {
      const url = new URL(req.url!, issuer);
      const json = (body: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/logout`,
          id_token_signing_alg_values_supported: ["RS256"],
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
        });
      }
      if (url.pathname === "/jwks") return json({ keys: [jwk] });
      if (url.pathname === "/authorize") {
        const code = randomUUID();
        codes.set(code, { nonce: url.searchParams.get("nonce") ?? "", claims: nextClaims });
        const back = new URL(url.searchParams.get("redirect_uri")!);
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state")!);
        res.statusCode = 302;
        res.setHeader("location", back.toString());
        return res.end();
      }
      if (url.pathname === "/token" && req.method === "POST") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const form = new URLSearchParams(raw);
          const entry = codes.get(form.get("code") ?? "");
          const basic = Buffer.from(
            (req.headers.authorization ?? "").replace("Basic ", ""),
            "base64",
          ).toString();
          if (!entry || basic !== `${client.id}:${client.secret}`) {
            res.statusCode = 400;
            return json({ error: "invalid_grant" });
          }
          const now = Math.floor(Date.now() / 1000);
          json({
            access_token: "at-" + randomUUID(),
            token_type: "Bearer",
            expires_in: 3600,
            id_token: signJwt({
              iss: issuer,
              aud: client.id,
              iat: now,
              exp: now + 600,
              nonce: entry.nonce,
              ...entry.claims,
            }),
          });
        });
        return;
      }
      if (url.pathname === "/userinfo")
        return json({ sub: nextClaims.sub, roles: ["instructor"], name: "From Userinfo" });
      res.statusCode = 404;
      res.end();
    });
  }

  return {
    client,
    get issuer() {
      return issuer;
    },
    setClaims(claims: Record<string, unknown>) {
      nextClaims = claims;
    },
    async start(): Promise<void> {
      server = handle();
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
      issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    },
    close() {
      server?.close();
    },
  };
}

/**
 * Drives the authorization-code flow of better-auth against a `createFakeIdp()` without a browser
 * and returns the callback response (the session cookie is in its `cookie`).
 */
export function oidcSignIn(
  fake: ReturnType<typeof createFakeIdp>,
  getAuth: () => Promise<{ handler: (r: Request) => Promise<Response> }>,
  origin: string,
) {
  async function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
    const auth = await getAuth();
    const res = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: init.body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          origin,
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        redirect: "manual",
      }),
    );
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => c && !c.endsWith("="))
      .join("; ");
    return { res, cookie };
  }
  return async (claims: Record<string, unknown>) => {
    fake.setClaims({ email_verified: true, ...claims });
    const start = await call("/sign-in/social", {
      body: { provider: "oidc", callbackURL: "/courses" },
    });
    const { url } = (await start.res.json()) as { url: string };
    const authz = await fetch(url, { redirect: "manual" });
    const back = new URL(authz.headers.get("location")!);
    return call(back.pathname.replace("/api/auth", "") + back.search, { cookie: start.cookie });
  };
}
