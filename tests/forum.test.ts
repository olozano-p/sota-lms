/**
 * The forum follows the course: a person reads and writes there only while they may open the
 * course; the general forum needs a session and the config switch. Moderation is the course's
 * teachers plus admins.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/index.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { course, courseTeacher, enrollment, person } from "../src/db/schema.ts";
import { requireForumAccess, type ForumCourse } from "../src/server/access/forum.ts";
import type { SessionUser } from "../src/server/auth/authz.ts";

type Role = "student" | "teacher" | "admin";

async function makePerson(sub: string, roles: Role[]): Promise<SessionUser> {
  const [p] = await db
    .insert(person)
    .values({
      externalSub: sub,
      email: `${sub}@example.invalid`,
      name: sub,
      roles,
      // A fresh sync stamp keeps `ensureFreshEnrollments` from trying to pull in tests.
      entitlementsSyncedAt: new Date(),
    })
    .returning();
  return {
    id: p!.id,
    sub,
    name: sub,
    email: p!.email,
    roles,
    locale: null,
    sessionId: "test",
  };
}

async function makeCourse(slug: string, forumEnabled: boolean): Promise<ForumCourse> {
  const [c] = await db
    .insert(course)
    .values({ slug, title: slug, language: "ca", status: "published", forumEnabled })
    .returning();
  return c!;
}

let open: ForumCourse;
let closed: ForumCourse;
let other: ForumCourse;
let student: SessionUser;
let lapsed: SessionUser;
let stranger: SessionUser;
let teacher: SessionUser;
let otherTeacher: SessionUser;
let admin: SessionUser;

beforeAll(async () => {
  await runMigrations();
  open = await makeCourse("open", true);
  closed = await makeCourse("closed", false);
  other = await makeCourse("other", true);
  student = await makePerson("student", ["student"]);
  lapsed = await makePerson("lapsed", ["student"]);
  stranger = await makePerson("stranger", ["student"]);
  teacher = await makePerson("teacher", ["teacher"]);
  otherTeacher = await makePerson("other-teacher", ["teacher"]);
  admin = await makePerson("admin", ["admin"]);
  await db.insert(enrollment).values([
    { personId: student.id, courseId: open.id, source: "manual" },
    { personId: student.id, courseId: closed.id, source: "manual" },
    // Past its window: the enrollment exists but no longer opens the course.
    {
      personId: lapsed.id,
      courseId: open.id,
      source: "webhook",
      externalId: "lapsed-1",
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil: new Date("2020-12-31T00:00:00Z"),
    },
  ]);
  await db.insert(courseTeacher).values([
    { courseId: open.id, personId: teacher.id },
    { courseId: other.id, personId: otherTeacher.id },
  ]);
});

const denied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ status: 403 });

describe("course forum", () => {
  it("lets an enrolled student in, as a plain member", async () => {
    const a = await requireForumAccess(student, open);
    expect(a.moderator).toBe(false);
    expect(a.course?.id).toBe(open.id);
  });
  it("keeps people out who are not enrolled, or whose enrollment has lapsed", async () => {
    await denied(requireForumAccess(stranger, open));
    await denied(requireForumAccess(lapsed, open));
  });
  it("is closed for everyone while the toggle is off", async () => {
    await denied(requireForumAccess(student, closed));
    await denied(requireForumAccess(teacher, closed));
    await denied(requireForumAccess(admin, closed));
  });
  it("makes the course's teachers and admins moderators, other teachers strangers", async () => {
    expect((await requireForumAccess(teacher, open)).moderator).toBe(true);
    expect((await requireForumAccess(admin, open)).moderator).toBe(true);
    await denied(requireForumAccess(otherTeacher, open));
  });
});

describe("general forum", () => {
  it("is open to every session; teachers and admins moderate", async () => {
    expect((await requireForumAccess(stranger, null)).moderator).toBe(false);
    expect((await requireForumAccess(otherTeacher, null)).moderator).toBe(true);
    expect((await requireForumAccess(admin, null)).moderator).toBe(true);
  });
});
