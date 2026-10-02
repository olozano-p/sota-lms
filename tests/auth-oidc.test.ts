/**
 * AUTH_MODE=oidc against a minimal in-process IdP (discovery, JWKS, RS256 ID tokens): provisioning
 * by sub, per-login refresh, roles, claim-driven enrollments, disabled local auth, break-glass
 * admin and RP-initiated logout.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFakeIdp } from "./helpers/fake-idp.ts";

const fake = createFakeIdp();
const CLIENT = fake.client;
let issuer = "";

const ORIGIN = "http://localhost:3003";
type Mods = {
  db: typeof import("../src/db/index.ts").db;
  schema: typeof import("../src/db/schema.ts");
  getAuth: typeof import("../src/server/auth/auth.ts").getAuth;
  resetEnvCache: typeof import("../src/config/env.ts").resetEnvCache;
};
let m: Mods;

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const auth = await m.getAuth();
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
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
  return {
    res,
    cookie,
    json: async () =>
      (await res
        .clone()
        .json()
        .catch(() => null)) as any,
  };
}

/** Runs the flow up to the IdP's redirect back; the returned function makes the callback. */
async function authorize(claims: Record<string, unknown>) {
  fake.setClaims({ email_verified: true, ...claims });
  const start = await call("/sign-in/social", {
    body: { provider: "oidc", callbackURL: "/courses" },
  });
  expect(start.res.status).toBe(200);
  const { url } = await start.json();
  const authz = await fetch(url, { redirect: "manual" });
  const back = new URL(authz.headers.get("location")!);
  return () => call(back.pathname.replace("/api/auth", "") + back.search, { cookie: start.cookie });
}

/** Runs the whole authorization-code flow and returns the session cookie. */
async function signIn(claims: Record<string, unknown>) {
  return (await authorize(claims))();
}

beforeAll(async () => {
  await fake.start();
  issuer = fake.issuer;
  process.env.AUTH_MODE = "oidc";
  process.env.APP_URL = ORIGIN;
  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT.id;
  process.env.OIDC_CLIENT_SECRET = CLIENT.secret;
  process.env.ENTITLEMENT_CLAIM = "enrollments";
  process.env.BREAK_GLASS_ADMIN_EMAIL = "root@example.invalid";
  const { db } = await import("../src/db/index.ts");
  const { runMigrations } = await import("../src/db/migrate.ts");
  await runMigrations();
  m = {
    db,
    schema: await import("../src/db/schema.ts"),
    getAuth: (await import("../src/server/auth/auth.ts")).getAuth,
    resetEnvCache: (await import("../src/config/env.ts")).resetEnvCache,
  };
});
afterAll(() => fake.close());

const person = () => m.schema.person;

describe("sign-in", () => {
  it("provisions the person by sub, maps roles and opens a session", async () => {
    const r = await signIn({
      sub: "s-1",
      email: "Ada@Example.invalid",
      name: "Ada",
      locale: "ca-ES",
      roles: ["instructor", "bogus"],
    });
    expect(r.res.status).toBe(302);
    expect(r.res.headers.get("location")).toContain("/courses");
    expect(r.cookie).toContain("sota.session_token");
    const [p] = await m.db.select().from(person()).where(eq(person().externalSub, "s-1"));
    expect(p).toMatchObject({
      email: "ada@example.invalid",
      name: "Ada",
      locale: "ca",
      roles: ["teacher"],
      externalIss: issuer,
      emailVerified: true,
    });
    const session = await (await call("/get-session", { cookie: r.cookie })).json();
    expect(session.user.id).toBe(p!.id);
  });

  it("updates name, email, locale and roles on every login, keyed by sub", async () => {
    const r = await signIn({
      sub: "s-1",
      email: "ada.new@example.invalid",
      name: "Ada Lovelace",
      locale: "es",
      roles: ["admin"],
    });
    expect(r.cookie).toContain("sota.session_token");
    const rows = await m.db.select().from(person()).where(eq(person().externalSub, "s-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "ada.new@example.invalid",
      name: "Ada Lovelace",
      locale: "es",
      roles: ["admin"],
    });
  });

  it("reads profile claims the ID token omits from the userinfo endpoint", async () => {
    await signIn({ sub: "s-2", email: "grace@example.invalid" });
    const [p] = await m.db.select().from(person()).where(eq(person().externalSub, "s-2"));
    expect(p).toMatchObject({ name: "From Userinfo", roles: ["teacher"] });
  });

  it("adopts a person the sync created earlier with the same email", async () => {
    const [pre] = await m.db
      .insert(person())
      .values({
        email: "pre@example.invalid",
        name: "Pre",
        externalSub: "s-pre",
        roles: ["student"],
      })
      .returning({ id: person().id });
    await signIn({ sub: "s-pre", email: "pre@example.invalid", name: "Pre", roles: ["student"] });
    const rows = await m.db
      .select()
      .from(person())
      .where(eq(person().email, "pre@example.invalid"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(pre!.id);
    const accounts = await m.db
      .select()
      .from(m.schema.authAccount)
      .where(eq(m.schema.authAccount.userId, pre!.id));
    expect(accounts.map((a) => a.providerId)).toEqual(["oidc"]);
    expect(accounts[0]!.accessToken).toBeNull();
  });

  it("links a person signing in from two tabs at once a single time and opens both sessions", async () => {
    const [pre] = await m.db
      .insert(person())
      .values({ email: "twin@example.invalid", name: "Twin", roles: ["student"] })
      .returning({ id: person().id });
    const claims = { sub: "s-twin", email: "twin@example.invalid", name: "Twin", roles: ["admin"] };
    const callbacks = [await authorize(claims), await authorize(claims)];
    const both = await Promise.all(callbacks.map((callback) => callback()));
    for (const r of both) {
      expect(r.res.headers.get("location")).toContain("/courses");
      expect(r.cookie).toContain("sota.session_token");
    }
    const accounts = await m.db
      .select()
      .from(m.schema.authAccount)
      .where(eq(m.schema.authAccount.userId, pre!.id));
    expect(accounts).toHaveLength(1);
    const [p] = await m.db.select().from(person()).where(eq(person().id, pre!.id));
    expect(p).toMatchObject({ externalSub: "s-twin", roles: ["admin"] });
  });

  it("queues the callbacks of one subject and lets other subjects through", async () => {
    const { queueOidcSignIn } = await import("../src/server/auth/identity.ts");
    const order: string[] = [];
    const first = await queueOidcSignIn("q-1");
    const second = queueOidcSignIn("q-1").then((release) => {
      order.push("second");
      release();
    });
    const other = await queueOidcSignIn("q-2");
    order.push("other");
    other();
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("first done");
    first();
    await second;
    expect(order).toEqual(["other", "first done", "second"]);
    (await queueOidcSignIn("q-1"))();
  });
});

describe("placeholder people from manual enrollment", () => {
  it("is adopted on first sign-in, keeping the enrollment that waited for it", async () => {
    const { course, enrollment } = m.schema;
    const [pre] = await m.db
      .insert(person())
      .values({
        email: "waiting@example.invalid",
        name: "waiting@example.invalid",
        roles: ["student"],
      })
      .returning({ id: person().id });
    const [c] = await m.db
      .insert(course)
      .values({ slug: "placeholder-course", title: "P", language: "en", status: "published" })
      .returning({ id: course.id });
    await m.db.insert(enrollment).values({ personId: pre!.id, courseId: c!.id, source: "manual" });
    await signIn({ sub: "s-wait", email: "Waiting@Example.invalid", name: "Waiting Learner" });
    const rows = await m.db
      .select()
      .from(person())
      .where(eq(person().email, "waiting@example.invalid"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: pre!.id, externalSub: "s-wait", name: "Waiting Learner" });
    const enr = await m.db.select().from(enrollment).where(eq(enrollment.personId, pre!.id));
    expect(enr).toMatchObject([{ source: "manual", status: "active" }]);
  });
});

describe("claim-driven enrollments", () => {
  it("reconciles claims rows and never touches manual or webhook rows", async () => {
    const { course, cohort, enrollment } = m.schema;
    const [c] = await m.db
      .insert(course)
      .values({ slug: "c-claim", externalRef: "ext-course", title: "C", language: "en" })
      .returning({ id: course.id });
    const [c2] = await m.db
      .insert(course)
      .values({ slug: "c-other", title: "O", language: "en" })
      .returning({ id: course.id });
    const [g] = await m.db
      .insert(cohort)
      .values({ courseId: c!.id, slug: "g-claim", externalRef: "ext-cohort", title: "G" })
      .returning({ id: cohort.id });

    await signIn({
      sub: "s-3",
      email: "claims@example.invalid",
      name: "Claims",
      roles: ["learner"],
    });
    const [p] = await m.db.select().from(person()).where(eq(person().externalSub, "s-3"));
    await m.db.insert(enrollment).values([
      { personId: p!.id, courseId: c2!.id, source: "manual" },
      { personId: p!.id, courseId: c2!.id, source: "webhook", externalId: "w-1" },
    ]);

    await signIn({
      sub: "s-3",
      email: "claims@example.invalid",
      name: "Claims",
      roles: ["learner"],
      enrollments: [
        { course: "ext-course", cohort: "ext-cohort", until: "2027-06-30T22:00:00Z" },
        { course: "c-other" },
        { course: "no-such-course" },
        { course: "c-claim", cohort: "no-such-cohort" },
      ],
    });
    const claims = () =>
      m.db
        .select()
        .from(enrollment)
        .where(and(eq(enrollment.personId, p!.id), eq(enrollment.source, "claims")));
    let rows = await claims();
    expect(rows).toHaveLength(2);
    const scoped = rows.find((r) => r.cohortId === g!.id)!;
    expect(scoped).toMatchObject({ courseId: c!.id, status: "active" });
    expect(scoped.validUntil?.toISOString()).toBe("2027-06-30T22:00:00.000Z");
    const members = await m.db
      .select()
      .from(m.schema.cohortMember)
      .where(eq(m.schema.cohortMember.personId, p!.id));
    expect(members.map((x) => x.cohortId)).toEqual([g!.id]);

    // Next login lists only the open-ended course: the cohort-scoped row expires.
    await signIn({
      sub: "s-3",
      email: "claims@example.invalid",
      name: "Claims",
      roles: ["learner"],
      enrollments: [{ course: "c-other" }],
    });
    rows = await claims();
    expect(rows.find((r) => r.cohortId === g!.id)?.status).toBe("expired");
    expect(rows.find((r) => r.courseId === c2!.id)?.status).toBe("active");

    const others = await m.db.select().from(enrollment).where(eq(enrollment.personId, p!.id));
    expect(others.filter((r) => r.source === "manual")).toHaveLength(1);
    expect(others.filter((r) => r.source === "webhook").map((r) => r.status)).toEqual(["active"]);

    // A malformed claim changes nothing; an absent claim changes nothing.
    await signIn({
      sub: "s-3",
      email: "claims@example.invalid",
      name: "Claims",
      enrollments: "bad",
    });
    expect((await claims()).map((r) => r.status).sort()).toEqual(["active", "expired"]);
    await signIn({ sub: "s-3", email: "claims@example.invalid", name: "Claims" });
    expect((await claims()).map((r) => r.status).sort()).toEqual(["active", "expired"]);
  });
});

describe("local authentication is off", () => {
  it("registers nobody and offers no magic link", async () => {
    const up = await call("/sign-up/email", {
      body: { email: "x@example.invalid", password: "long enough password", name: "X" },
    });
    expect(up.res.status).toBeGreaterThanOrEqual(400);
    expect(
      (await call("/sign-in/magic-link", { body: { email: "x@example.invalid" } })).res.status,
    ).toBe(404);
    expect((await call("/invite/preview?token=x")).res.status).toBe(404);
    expect(
      await m.db.select().from(person()).where(eq(person().email, "x@example.invalid")),
    ).toHaveLength(0);
  });

  it("refuses password sign-in for everyone but the break-glass administrator", async () => {
    const { upsertCredentialPerson } = await import("../src/server/auth/accounts.ts");
    await upsertCredentialPerson({
      email: "someone@example.invalid",
      name: "S",
      password: "long enough password",
      roles: ["admin"],
    });
    const other = await call("/sign-in/email", {
      body: { email: "someone@example.invalid", password: "long enough password" },
    });
    expect(other.res.status).toBe(403);

    await upsertCredentialPerson({
      email: "root@example.invalid",
      name: "Root",
      password: "break glass password",
      roles: ["admin"],
    });
    const wrong = await call("/sign-in/email", {
      body: { email: "root@example.invalid", password: "nope nope nope" },
    });
    expect(wrong.res.status).toBe(401);
    const ok = await call("/sign-in/email", {
      body: { email: "ROOT@example.invalid", password: "break glass password" },
    });
    expect(ok.res.status).toBe(200);
    expect(ok.cookie).toContain("sota.session_token");
  });

  it("requires the break-glass account to be an administrator", async () => {
    await m.db
      .update(person())
      .set({ roles: ["student"] })
      .where(eq(person().email, "root@example.invalid"));
    const r = await call("/sign-in/email", {
      body: { email: "root@example.invalid", password: "break glass password" },
    });
    expect(r.res.status).toBe(403);
    await m.db
      .update(person())
      .set({ roles: ["admin"] })
      .where(eq(person().email, "root@example.invalid"));
  });
});

describe("logout", () => {
  it("returns the provider end-session URL with the ID token hint", async () => {
    const r = await signIn({ sub: "s-9", email: "out@example.invalid", name: "Out" });
    const out = await call("/sign-out", {
      method: "POST",
      body: { callbackURL: "/" },
      cookie: r.cookie,
    });
    const body = await out.json();
    expect(body.success).toBe(true);
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe(`${issuer}/logout`);
    expect(url.searchParams.get("id_token_hint")).toMatch(/^eyJ/);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(`${ORIGIN}/`);
    const after = await (await call("/get-session", { cookie: r.cookie })).json();
    expect(after).toBeNull();
  });

  it("navigation helpers: the login redirect and the sign-out redirect", async () => {
    const { beginOidcLogin, endSession, safeReturnTo } =
      await import("../src/server/auth/flows.ts");
    expect(safeReturnTo("//evil.example")).toBe("/courses");
    expect(safeReturnTo("/auth/logout")).toBe("/courses");
    expect(safeReturnTo("/courses/x")).toBe("/courses/x");

    const start = await beginOidcLogin(new Request(`${ORIGIN}/auth/login`), "/courses/x");
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain(`${issuer}/authorize`);
    expect(start.headers.getSetCookie().length).toBeGreaterThan(0);

    const r = await signIn({ sub: "s-10", email: "nav@example.invalid", name: "Nav" });
    const out = await endSession(
      new Request(`${ORIGIN}/auth/logout`, { headers: { cookie: r.cookie } }),
    );
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toContain(`${issuer}/logout`);
    expect(out.headers.getSetCookie().join(";")).toContain("sota.session_token=;");
  });
});
