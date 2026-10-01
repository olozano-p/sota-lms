/** AUTH_MODE=local on the in-memory PGlite: signup rules, invitations, magic links, roles. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("../src/server/services/email/mailer.ts", () => ({
  sendMail: async (mail: { to: string; subject: string; text: string }) => {
    sent.push(mail);
  },
}));

process.env.AUTH_MODE = "local";
process.env.ALLOW_SIGNUP = "false";
process.env.APP_URL = "http://localhost:3003";

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const { person, authAccount, invitation, auditLog } = await import("../src/db/schema.ts");
const { resetEnvCache } = await import("../src/config/env.ts");
const { getAuth, pastAbsoluteLimit, SESSION_ABSOLUTE_MS } =
  await import("../src/server/auth/auth.ts");
const { createInvitation, replaceRoles } = await import("../src/server/mutations/people.ts");
const { sendImmediate } = await import("../src/server/services/notifications.ts");

const ORIGIN = "http://localhost:3003";

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const auth = await getAuth();
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

/** Flushes the queue and returns the link of the last mail sent to the address. */
async function linkFor(email: string): Promise<string> {
  await sendImmediate();
  const mail = [...sent].reverse().find((m) => m.to === email);
  expect(mail, `mail to ${email}`).toBeTruthy();
  return mail!.text.match(/https?:\/\/\S+/)![0];
}

const pathOf = (link: string) => {
  const u = new URL(link);
  return u.pathname.replace("/api/auth", "") + u.search;
};

const me = async (cookie: string) => (await call("/get-session", { cookie })).json();

beforeAll(async () => {
  await runMigrations();
});
beforeEach(() => {
  sent.length = 0;
});

describe("first user and signup rules", () => {
  it("makes the first sign-up an admin, after the email is verified", async () => {
    const r = await call("/sign-up/email", {
      body: { email: "First@Example.invalid", password: "correct horse battery", name: "First" },
    });
    expect(r.res.status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.email, "first@example.invalid"));
    expect(p?.roles).toEqual(["admin"]);
    expect(r.cookie).toBe("");

    const blocked = await call("/sign-in/email", {
      body: { email: "first@example.invalid", password: "correct horse battery" },
    });
    expect(blocked.res.status).toBe(403);

    const verified = await call(pathOf(await linkFor("first@example.invalid")));
    expect(verified.cookie).toContain("sota.session_token");
    const session = await me(verified.cookie);
    expect(session.user.email).toBe("first@example.invalid");
    expect(session.user.roles).toEqual(["admin"]);
  });

  it("refuses further sign-ups while ALLOW_SIGNUP is off", async () => {
    const r = await call("/sign-up/email", {
      body: { email: "second@example.invalid", password: "correct horse battery", name: "Second" },
    });
    // With email verification required the library answers uniformly (no account enumeration).
    expect(r.cookie).toBe("");
    await sendImmediate();
    expect(sent.some((m) => m.to === "second@example.invalid")).toBe(false);
    expect(
      await db.select().from(person).where(eq(person.email, "second@example.invalid")),
    ).toHaveLength(0);
  });

  it("opens sign-up with ALLOW_SIGNUP and never lets the body choose roles", async () => {
    process.env.ALLOW_SIGNUP = "true";
    resetEnvCache();
    const r = await call("/sign-up/email", {
      body: {
        email: "open@example.invalid",
        password: "correct horse battery",
        name: "Open",
        roles: ["admin"],
      },
    });
    expect(r.res.status).toBe(200);
    const [p] = await db.select().from(person).where(eq(person.email, "open@example.invalid"));
    expect(p?.roles).toEqual(["student"]);
    process.env.ALLOW_SIGNUP = "false";
    resetEnvCache();
  });

  it("caps a session at 12 hours regardless of activity", () => {
    const now = Date.now();
    expect(pastAbsoluteLimit(new Date(now - SESSION_ABSOLUTE_MS + 1000), now)).toBe(false);
    expect(pastAbsoluteLimit(new Date(now - SESSION_ABSOLUTE_MS), now)).toBe(true);
  });
});

describe("invitations", () => {
  const admin = { id: "", name: "Admin" };
  beforeAll(async () => {
    const [a] = await db.select().from(person).where(eq(person.email, "first@example.invalid"));
    admin.id = a!.id;
  });

  it("invites by email, then the one-time link sets a password and signs in", async () => {
    const { token, personId } = await db.transaction((tx) =>
      createInvitation(tx, admin, {
        email: "invited@example.invalid",
        name: "Invited",
        roles: ["teacher"],
      }),
    );
    const link = await linkFor("invited@example.invalid");
    expect(link).toContain(`/accept-invite?token=${token}`);

    const preview = await call(`/invite/preview?token=${token}`);
    expect((await preview.json()).email).toBe("invited@example.invalid");

    const weak = await call("/invite/accept", { body: { token, password: "short" } });
    expect(weak.res.status).toBe(400);

    const ok = await call("/invite/accept", { body: { token, password: "a long enough secret" } });
    expect(ok.res.status).toBe(200);
    const session = await me(ok.cookie);
    expect(session.user.roles).toEqual(["teacher"]);

    const again = await call("/invite/accept", {
      body: { token, password: "another long secret" },
    });
    expect(again.res.status).toBe(400);
    expect((await call(`/invite/preview?token=${token}`)).res.status).toBe(400);

    const login = await call("/sign-in/email", {
      body: { email: "invited@example.invalid", password: "a long enough secret" },
    });
    expect(login.res.status).toBe(200);
    expect(login.cookie).toContain("sota.session_token");

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, personId));
    expect(audits.map((a) => a.action).sort()).toEqual(["invitation.accept", "person.invite"]);
    const rows = await db.select().from(invitation).where(eq(invitation.personId, personId));
    expect(rows[0]?.acceptedAt).toBeTruthy();
  });

  it("does not store the token, and refuses to re-invite someone who has a password", async () => {
    const { token } = await db.transaction((tx) =>
      createInvitation(tx, admin, {
        email: "stored@example.invalid",
        name: "S",
        roles: ["student"],
      }),
    );
    const rows = await db.select().from(invitation);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    await expect(
      db.transaction((tx) =>
        createInvitation(tx, admin, {
          email: "invited@example.invalid",
          name: "I",
          roles: ["student"],
        }),
      ),
    ).rejects.toThrow(/already has an account/);
    const accounts = await db.select().from(authAccount);
    expect(accounts.some((a) => a.password === "a long enough secret")).toBe(false);
  });

  it("scrubs the one-time link from the queue once the mail is sent", async () => {
    await linkFor("stored@example.invalid");
    const { notification } = await import("../src/db/schema.ts");
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.toEmail, "stored@example.invalid"));
    expect(rows.every((r) => (r.payload as { url: string }).url === "" && r.sentAt)).toBe(true);
  });
});

describe("magic link", () => {
  it("mails a link to a known address and signs them in once", async () => {
    const r = await call("/sign-in/magic-link", {
      body: { email: "invited@example.invalid", callbackURL: "/courses" },
    });
    expect(r.res.status).toBe(200);
    const link = await linkFor("invited@example.invalid");
    const verified = await call(pathOf(link));
    expect(verified.cookie).toContain("sota.session_token");
    expect((await me(verified.cookie)).user.email).toBe("invited@example.invalid");
    const reuse = await call(pathOf(link));
    expect(reuse.cookie).toBe("");
  });

  it("answers the same for an unknown address when sign-up is closed, and sends nothing", async () => {
    const r = await call("/sign-in/magic-link", { body: { email: "ghost@example.invalid" } });
    expect(r.res.status).toBe(200);
    await sendImmediate();
    expect(sent.some((m) => m.to === "ghost@example.invalid")).toBe(false);
    expect(
      await db.select().from(person).where(eq(person.email, "ghost@example.invalid")),
    ).toHaveLength(0);
  });

  it("creates a student from a magic link when sign-up is open", async () => {
    process.env.ALLOW_SIGNUP = "true";
    resetEnvCache();
    await call("/sign-in/magic-link", {
      body: { email: "walkin@example.invalid", name: "Walk In" },
    });
    const verified = await call(pathOf(await linkFor("walkin@example.invalid")));
    expect(verified.cookie).toContain("sota.session_token");
    const [p] = await db.select().from(person).where(eq(person.email, "walkin@example.invalid"));
    expect(p?.roles).toEqual(["student"]);
    expect(p?.emailVerified).toBe(true);
    process.env.ALLOW_SIGNUP = "false";
    resetEnvCache();
  });
});

describe("roles", () => {
  it("does not demote the last administrator", async () => {
    const [a] = await db.select().from(person).where(eq(person.email, "first@example.invalid"));
    await expect(
      db.transaction((tx) => replaceRoles(tx, a!.id, a!.id, ["teacher"])),
    ).rejects.toThrow(/last administrator/);
    const [t] = await db.select().from(person).where(eq(person.email, "invited@example.invalid"));
    await db.transaction((tx) => replaceRoles(tx, a!.id, t!.id, ["student", "teacher"]));
    const [after] = await db.select().from(person).where(eq(person.id, t!.id));
    expect(after?.roles).toEqual(["student", "teacher"]);
  });

  it("has no OIDC endpoints in local mode", async () => {
    const r = await call("/sign-in/social", { body: { provider: "oidc", callbackURL: "/" } });
    expect(r.res.status).toBeGreaterThanOrEqual(400);
  });
});
