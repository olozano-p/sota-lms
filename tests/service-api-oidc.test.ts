/**
 * Phase 4 exit: SOTA in oidc mode against an IdP, an enrollment pushed through the service API for
 * people who have not signed in yet, the sign-in, access to the course, and revocation through the
 * API. Runs against the in-process fake IdP; CI repeats the flow against dev/mock-idp (e2e).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createFakeIdp, oidcSignIn } from "./helpers/fake-idp.ts";

const fake = createFakeIdp();
const ORIGIN = "http://localhost:3003";
const TOKEN = "k".repeat(40);
const SECRET = "journey-hmac-secret";

type Mods = {
  db: typeof import("../src/db/index.ts").db;
  schema: typeof import("../src/db/schema.ts");
  api: typeof import("../src/server/api/v1/dispatch.ts").handleApiV1;
  sign: typeof import("../src/server/auth/service.ts").signServiceRequest;
  requireLessonAccess: typeof import("../src/server/access/require.ts").requireLessonAccess;
};
let m: Mods;
let signIn: ReturnType<typeof oidcSignIn>;
let lessonId: string;

/** A signed service call, as docs/integration.md shows it. */
async function call(method: string, path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await m.api(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "x-timestamp": ts,
        "x-signature": m.sign(SECRET, ts, method, `/api/v1${path}`, raw),
      },
      body: method === "GET" ? undefined : raw,
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

/** The signed-in person as the guards see them, and whether the lesson opens for them. */
async function canOpen(email: string): Promise<boolean> {
  const [p] = await m.db
    .select()
    .from(m.schema.person)
    .where(eq(m.schema.person.email, email.toLowerCase()));
  const user = {
    id: p!.id,
    sub: p!.externalSub,
    name: p!.name,
    email: p!.email,
    roles: p!.roles as ("student" | "teacher" | "admin")[],
    locale: null,
    sessionId: "test",
  };
  return m.requireLessonAccess(user, lessonId).then(
    () => true,
    () => false,
  );
}

beforeAll(async () => {
  await fake.start();
  Object.assign(process.env, {
    AUTH_MODE: "oidc",
    APP_URL: ORIGIN,
    OIDC_ISSUER: fake.issuer,
    OIDC_CLIENT_ID: fake.client.id,
    OIDC_CLIENT_SECRET: fake.client.secret,
    API_SERVICE_TOKEN: TOKEN,
    WEBHOOK_HMAC_SECRET: SECRET,
  });
  const { db } = await import("../src/db/index.ts");
  await (await import("../src/db/migrate.ts")).runMigrations();
  const schema = await import("../src/db/schema.ts");
  m = {
    db,
    schema,
    api: (await import("../src/server/api/v1/dispatch.ts")).handleApiV1,
    sign: (await import("../src/server/auth/service.ts")).signServiceRequest,
    requireLessonAccess: (await import("../src/server/access/require.ts")).requireLessonAccess,
  };
  signIn = oidcSignIn(fake, (await import("../src/server/auth/auth.ts")).getAuth, ORIGIN);

  const [c] = await db
    .insert(schema.course)
    .values({
      slug: "journey",
      externalRef: "crs-journey",
      title: "J",
      language: "en",
      status: "published",
    })
    .returning({ id: schema.course.id });
  const [ch] = await db
    .insert(schema.chapter)
    .values({ courseId: c!.id, slug: "ch", title: "Ch" })
    .returning({ id: schema.chapter.id });
  const [l] = await db
    .insert(schema.lesson)
    .values({ chapterId: ch!.id, slug: "l", title: "L", status: "published" })
    .returning({ id: schema.lesson.id });
  lessonId = l!.id;
});
afterAll(() => fake.close());

describe("enrollment pushed before the first sign-in", () => {
  it("waits on a sub-only placeholder, opens the course at sign-in and closes on DELETE", async () => {
    const put = await call("PUT", "/enrollments/ord-1-line-1", {
      user: { sub: "idp-user-1" },
      course: "crs-journey",
    });
    expect(put.status).toBe(201);
    expect(put.json.enrollment.user.pending).toBe(true);

    // The IdP knows the person under a real address the service never sent.
    const login = await signIn({
      sub: "idp-user-1",
      email: "Learner@Example.invalid",
      name: "Lea",
    });
    expect(login.cookie).toContain("sota.session_token");

    const people = await m.db
      .select()
      .from(m.schema.person)
      .where(eq(m.schema.person.externalSub, "idp-user-1"));
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      email: "learner@example.invalid",
      name: "Lea",
      emailOptOut: false,
    });
    expect(people[0]!.externalIss).toBe(fake.issuer);
    expect(await canOpen("learner@example.invalid")).toBe(true);

    const progress = await call("GET", "/users/idp-user-1/progress");
    expect(progress.json.courses).toMatchObject([{ slug: "journey", lessons_total: 1 }]);

    const revoked = await call("DELETE", "/enrollments/ord-1-line-1");
    expect(revoked.json).toMatchObject({ found: true, changed: true });
    expect(await canOpen("learner@example.invalid")).toBe(false);

    const again = await call("PUT", "/enrollments/ord-1-line-1", {
      user: { sub: "idp-user-1" },
      course: "journey",
    });
    expect(again.status).toBe(200);
    expect(await canOpen("learner@example.invalid")).toBe(true);
  });

  it("waits on an email placeholder and is adopted by the same address", async () => {
    await call("PUT", "/enrollments/ord-2-line-1", {
      user: { sub: "idp-user-2", email: "second@example.invalid" },
      course: "journey",
      valid_until: "2999-01-01T00:00:00Z",
    });
    const [pre] = await m.db
      .select()
      .from(m.schema.person)
      .where(eq(m.schema.person.email, "second@example.invalid"));
    await signIn({ sub: "idp-user-2", email: "second@example.invalid", name: "Second" });
    const rows = await m.db
      .select()
      .from(m.schema.person)
      .where(eq(m.schema.person.email, "second@example.invalid"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(pre!.id);
    expect(await canOpen("second@example.invalid")).toBe(true);
    await call("DELETE", "/enrollments/ord-2-line-1");
    expect(await canOpen("second@example.invalid")).toBe(false);
  });

  it("an enrollment that expired on the service side does not open the course", async () => {
    await call("PUT", "/enrollments/ord-3-line-1", {
      user: { sub: "idp-user-3", email: "third@example.invalid" },
      course: "journey",
      valid_until: "2020-01-01T00:00:00Z",
    });
    await signIn({ sub: "idp-user-3", email: "third@example.invalid", name: "Third" });
    expect(await canOpen("third@example.invalid")).toBe(false);
  });

  it("keeps a manual grant when the service revokes its own row", async () => {
    await signIn({ sub: "idp-user-4", email: "fourth@example.invalid", name: "Fourth" });
    const [p] = await m.db
      .select()
      .from(m.schema.person)
      .where(eq(m.schema.person.email, "fourth@example.invalid"));
    const [c] = await m.db
      .select()
      .from(m.schema.course)
      .where(eq(m.schema.course.slug, "journey"));
    await m.db
      .insert(m.schema.enrollment)
      .values({ personId: p!.id, courseId: c!.id, source: "manual" });
    await call("PUT", "/enrollments/ord-4-line-1", {
      user: { sub: "idp-user-4" },
      course: "journey",
    });
    await call("DELETE", "/enrollments/ord-4-line-1");
    expect(await canOpen("fourth@example.invalid")).toBe(true);
  });
});
