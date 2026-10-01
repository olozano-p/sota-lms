/**
 * Server-only guards. Never import this module from a component or a route body: it drags the
 * database into the client bundle. Server functions and handlers call it; `session.ts` is the
 * client-safe surface.
 */
import { and, eq } from "drizzle-orm";
import { getRequest } from "@tanstack/react-start/server";
import { db } from "~/db";
import { courseTeacher, type Role } from "~/db/schema";
import { isLocale, type Locale } from "~/i18n/locale";
import { getAuth, pastAbsoluteLimit } from "./auth";
import { mapRoles } from "./roles";

export interface SessionUser {
  id: string;
  /** The person's key at the IdP or enrollment source; null for people who exist only locally. */
  sub: string | null;
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

/**
 * The signed-in user for the current request, or null. better-auth validates the cookie and the
 * idle lifetime; the 12 h absolute cap is applied here, and a session past it is revoked. Roles are
 * read from `person` on every request, so a change by an admin or the IdP applies at once.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const found = await auth.api.getSession({ headers: getRequest().headers });
  if (!found) return null;
  if (pastAbsoluteLimit(found.session.createdAt)) {
    await auth.api.signOut({ headers: getRequest().headers }).catch(() => undefined);
    return null;
  }
  const u = found.user;
  return {
    id: u.id,
    sub: u.externalSub ?? null,
    name: u.name,
    email: u.email,
    roles: mapRoles(u.roles),
    locale: isLocale(u.locale) ? u.locale : null,
    sessionId: found.session.id,
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
