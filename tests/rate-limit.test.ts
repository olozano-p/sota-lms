/**
 * Rate-limit coverage: every credential, mail or recovery endpoint of the real better-auth
 * instance sits in the strict bucket, the service API, the legacy webhook and server functions
 * have buckets of their own, and one address cannot be mailed more than the throttle allows.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../src/server/services/email/mailer.ts", () => ({ sendMail: async () => {} }));
process.env.AUTH_MODE = "local";
process.env.ALLOW_SIGNUP = "true";
process.env.APP_URL = "http://localhost:3003";

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const s = await import("../src/db/schema.ts");
const { getAuth } = await import("../src/server/auth/auth.ts");
const { allowRequest, limitFor } = await import("../src/server/security.ts");
const { ACCOUNT_MAIL_LIMIT, ACCOUNT_MAIL_PER_KIND, ACCOUNT_MAIL_WINDOW_MS, enqueueAccountMail } =
  await import("../src/server/services/notifications.ts");
const { createInvitation } = await import("../src/server/mutations/people-core.ts");

const req = (ip: string) =>
  new Request("http://localhost/x", { headers: { "x-sota-remote-addr": ip } });

beforeAll(async () => {
  await runMigrations();
});

describe("endpoint coverage", () => {
  it("puts every credential, mail and recovery endpoint of the auth instance in the strict bucket", async () => {
    const auth = await getAuth();
    const paths = Object.values(auth.api as Record<string, { path?: string }>)
      .map((e) => e.path)
      .filter((p): p is string => typeof p === "string");
    // The instance really exposes the endpoints the limiter has to cover.
    for (const needed of [
      "/sign-in/email",
      "/sign-up/email",
      "/sign-in/magic-link",
      "/magic-link/verify",
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/invite/accept",
      "/invite/preview",
    ])
      expect(paths, needed).toContain(needed);
    const sensitive =
      /password|magic-link|sign-in\/email|sign-up|verify-email|send-verification|invite\/|change-email|delete-user/;
    for (const p of paths) {
      const limit = limitFor(`/api/auth${p}`);
      expect(limit, p).not.toBeNull();
      if (sensitive.test(p)) expect(limit!.bucket, p).toBe("auth-sensitive");
    }
  });
  it("gives each channel a limit of its own", () => {
    expect(limitFor("/api/auth/sign-in/magic-link")).toEqual({
      bucket: "auth-sensitive",
      perMinute: 10,
    });
    expect(limitFor("/api/v1/enrollments/x")).toEqual({ bucket: "/api/v1/", perMinute: 300 });
    expect(limitFor("/api/webhooks/entitlements")).toEqual({
      bucket: "/api/webhooks/",
      perMinute: 60,
    });
    expect(limitFor("/_serverFn/abc")?.perMinute).toBe(600);
    expect(limitFor("/api/health")).toEqual({ bucket: "/api/health", perMinute: 600 });
    expect(limitFor("/api/v1/health")?.bucket).toBe("/api/v1/health");
    expect(limitFor("/api/files/x")?.bucket).toBe("/api/");
    expect(limitFor("/courses/intro")).toBeNull();
  });
});

describe("enforcement", () => {
  const t0 = Date.now();
  it("refuses the 61st legacy webhook call of a minute and spares other clients", () => {
    for (let i = 0; i < 60; i++)
      expect(allowRequest(req("10.9.0.1"), "/api/webhooks/entitlements", t0)).toBe(true);
    expect(allowRequest(req("10.9.0.1"), "/api/webhooks/entitlements", t0)).toBe(false);
    expect(allowRequest(req("10.9.0.2"), "/api/webhooks/entitlements", t0)).toBe(true);
  });
  it("shares one strict bucket between sign-in, magic link, reset and invitation endpoints", () => {
    const paths = [
      "/api/auth/sign-in/magic-link",
      "/api/auth/magic-link/verify",
      "/api/auth/request-password-reset",
      "/api/auth/reset-password/some-token",
      "/api/auth/invite/accept",
      "/api/auth/sign-up/email",
    ];
    for (let i = 0; i < 10; i++)
      expect(allowRequest(req("10.9.1.1"), paths[i % paths.length]!, t0)).toBe(true);
    for (const p of paths) expect(allowRequest(req("10.9.1.1"), p, t0)).toBe(false);
  });
  it("limits server functions per client", () => {
    for (let i = 0; i < 600; i++)
      expect(allowRequest(req("10.9.2.1"), "/_serverFn/x", t0)).toBe(true);
    expect(allowRequest(req("10.9.2.1"), "/_serverFn/x", t0)).toBe(false);
    expect(allowRequest(req("10.9.2.1"), "/api/files/x", t0)).toBe(true);
  });
});

describe("per-address mail throttle", () => {
  const payload = { courseTitle: "", url: "https://example.invalid/x" };
  const queued = (email: string) =>
    db.select().from(s.notification).where(eq(s.notification.toEmail, email));

  it("queues five of a kind an hour per address, twelve in all, then refuses", async () => {
    const now = new Date();
    for (let i = 0; i < ACCOUNT_MAIL_PER_KIND; i++)
      expect(
        await enqueueAccountMail(db, "Flood@Example.invalid", "auth_magic_link", payload, now),
      ).toBe(true);
    expect(
      await enqueueAccountMail(db, "flood@example.invalid", "auth_magic_link", payload, now),
    ).toBe(false);
    expect(await queued("flood@example.invalid")).toHaveLength(ACCOUNT_MAIL_PER_KIND);
    // A flood of one kind leaves the address's password-reset mail alone.
    expect(
      await enqueueAccountMail(db, "flood@example.invalid", "auth_reset_password", payload, now),
    ).toBe(true);
    // The overall cap holds across kinds.
    const kinds = ["auth_invite", "auth_verify_email", "auth_reset_password"] as const;
    let accepted = 0;
    for (let i = 0; i < 30; i++)
      if (await enqueueAccountMail(db, "flood@example.invalid", kinds[i % 3]!, payload, now))
        accepted++;
    expect(await queued("flood@example.invalid")).toHaveLength(ACCOUNT_MAIL_LIMIT);
    expect(accepted).toBe(ACCOUNT_MAIL_LIMIT - ACCOUNT_MAIL_PER_KIND - 1);
    // Another address is unaffected, and the window slides.
    expect(
      await enqueueAccountMail(db, "other@example.invalid", "auth_magic_link", payload, now),
    ).toBe(true);
    const later = new Date(now.getTime() + ACCOUNT_MAIL_WINDOW_MS + 60_000);
    expect(
      await enqueueAccountMail(db, "flood@example.invalid", "auth_magic_link", payload, later),
    ).toBe(true);
  });

  it("stops the magic-link endpoint from mailing one address more than the limit, with the same answer", async () => {
    const auth = await getAuth();
    await db
      .insert(s.person)
      .values({ email: "known@example.invalid", name: "Known", roles: ["student"] });
    const statuses: number[] = [];
    for (let i = 0; i < ACCOUNT_MAIL_PER_KIND + 3; i++) {
      const res = await auth.handler(
        new Request("http://localhost:3003/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3003" },
          body: JSON.stringify({ email: "known@example.invalid" }),
        }),
      );
      statuses.push(res.status);
    }
    expect(new Set(statuses)).toEqual(new Set([200]));
    expect(await queued("known@example.invalid")).toHaveLength(ACCOUNT_MAIL_PER_KIND);
  });

  it("reports a throttled invitation instead of pretending the mail went out", async () => {
    const [admin] = await db
      .insert(s.person)
      .values({ email: "adm@example.invalid", name: "Adm", roles: ["admin"] })
      .returning();
    const actor = { id: admin!.id, name: admin!.name };
    const input = {
      email: "invitee@example.invalid",
      name: "Invitee",
      roles: ["student" as const],
    };
    const results = [];
    for (let i = 0; i < ACCOUNT_MAIL_PER_KIND + 1; i++)
      results.push(await db.transaction((tx) => createInvitation(tx, actor, input)));
    expect(results.map((r) => r.mailQueued)).toEqual([true, true, true, true, true, false]);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "person.invite"));
    expect(audits.filter((a) => (a.diff as any).after.mailQueued === false)).toHaveLength(1);
    // The refused re-invite did not replace the link the invitee was last mailed.
    const { findOpenInvitation } = await import("../src/server/auth/invitations.ts");
    expect(results[5]!.token).toBeNull();
    expect(await findOpenInvitation(results[4]!.token!)).toMatchObject({
      email: "invitee@example.invalid",
    });
  });
});
