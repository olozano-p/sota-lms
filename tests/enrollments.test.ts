/** Manual enrollments and the uniqueness the schema enforces (ADR-014). */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { cohort, course, enrollment, person } from "../src/db/schema.ts";
import { upsertManualEnrollment } from "../src/server/mutations/enrollments.ts";

let personId: string;
let courseId: string;
let cohortId: string;

beforeAll(async () => {
  await runMigrations();
  const [p] = await db
    .insert(person)
    .values({ externalSub: "enr-1", email: "enr@example.invalid", name: "Enr" })
    .returning({ id: person.id });
  const [c] = await db
    .insert(course)
    .values({ slug: "enr-course", title: "C", language: "en" })
    .returning({ id: course.id });
  const [g] = await db
    .insert(cohort)
    .values({ courseId: c!.id, slug: "enr-cohort", title: "G" })
    .returning({ id: cohort.id });
  personId = p!.id;
  courseId = c!.id;
  cohortId = g!.id;
});

describe("upsertManualEnrollment", () => {
  it("creates once per person, course, cohort and renews the same row", async () => {
    const first = await upsertManualEnrollment(db, { personId, courseId, cohortId: null });
    expect(first.before).toBeNull();
    expect(first.row).toMatchObject({ source: "manual", status: "active", validUntil: null });

    const until = new Date("2027-01-01T00:00:00Z");
    await db.update(enrollment).set({ status: "revoked" }).where(eq(enrollment.id, first.row.id));
    const renewed = await upsertManualEnrollment(db, {
      personId,
      courseId,
      cohortId: null,
      validUntil: until,
    });
    expect(renewed.row.id).toBe(first.row.id);
    expect(renewed.row).toMatchObject({ status: "active", validUntil: until });
  });
  it("keeps the course-wide and the cohort-scoped rows apart", async () => {
    await upsertManualEnrollment(db, { personId, courseId, cohortId });
    const rows = await db.select().from(enrollment).where(eq(enrollment.personId, personId));
    expect(rows).toHaveLength(2);
  });
  it("rejects a second row for the same key at the database", async () => {
    await expect(
      db.insert(enrollment).values({ personId, courseId, cohortId, source: "manual" }),
    ).rejects.toThrow();
  });
});
