/**
 * Server-only guards. Never import this module from a component or a route body: it drags the
 * database into the client bundle. Server functions and handlers call it; `session.ts` is the
 * client-safe surface.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { db } from "~/db";
import { courseTeacher, person, session, type Role } from "~/db/schema";
import { env } from "~/config/env";
import { isLocale, type Locale } from "~/i18n/locale";

export const SESSION_COOKIE = "lodro_session";
/** 12 h absolute, 2 h idle (docs/spec.md §8). */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  sub: string;
  name: string;
  email: string;
  roles: Role[];
  locale: Locale | null;
  sessionId: string;
}

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(status === 401 ? "Sign in required" : "Not allowed");
  }
}

function sign(id: string): string {
  return createHmac("sha256", env.sessionSecret).update(id).digest("base64url");
}

export function encodeSessionCookie(id: string): string {
  return `${id}.${sign(id)}`;
}

function decodeSessionCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
  };
}

export function setSessionCookie(id: string): void {
  setCookie(
    SESSION_COOKIE,
    encodeSessionCookie(id),
    sessionCookieOptions(SESSION_ABSOLUTE_MS / 1000),
  );
}

export function clearSessionCookie(): void {
  setCookie(SESSION_COOKIE, "", sessionCookieOptions(0));
}

function toRoles(values: string[]): Role[] {
  return values.filter((r): r is Role => r === "student" || r === "teacher" || r === "admin");
}

/** The signed-in user for the current request, or null. Expired sessions are deleted on sight. */
export async function currentUser(): Promise<SessionUser | null> {
  getRequest();
  const id = decodeSessionCookie(getCookie(SESSION_COOKIE));
  if (!id) return null;
  const rows = await db
    .select({ s: session, p: person })
    .from(session)
    .innerJoin(person, eq(person.id, session.personId))
    .where(eq(session.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  const expired =
    row.s.absoluteExpiresAt.getTime() <= now || row.s.lastSeenAt.getTime() + SESSION_IDLE_MS <= now;
  if (expired) {
    await db.delete(session).where(eq(session.id, id));
    clearSessionCookie();
    return null;
  }
  if (row.s.lastSeenAt.getTime() + TOUCH_EVERY_MS <= now) {
    const at = new Date(now);
    await db.update(session).set({ lastSeenAt: at }).where(eq(session.id, id));
    await db.update(person).set({ lastSeenAt: at }).where(eq(person.id, row.p.id));
  }
  return {
    id: row.p.id,
    sub: row.p.idpSub,
    name: row.p.name,
    email: row.p.email,
    roles: toRoles(row.p.roles),
    locale: isLocale(row.p.locale) ? row.p.locale : null,
    sessionId: row.s.id,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthorizationError(401);
  return user;
}

export function hasRole(user: SessionUser, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

/** Admin satisfies every role check. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, "admin", ...roles)) throw new AuthorizationError(403);
  return user;
}

/** Teachers may author only the courses they are assigned to; admins may author all. */
export async function requireCourseTeacher(courseId: string): Promise<SessionUser> {
  const user = await requireRole("teacher");
  if (hasRole(user, "admin")) return user;
  const rows = await db
    .select({ courseId: courseTeacher.courseId })
    .from(courseTeacher)
    .where(and(eq(courseTeacher.courseId, courseId), eq(courseTeacher.personId, user.id)))
    .limit(1);
  if (!rows[0]) throw new AuthorizationError(403);
  return user;
}
