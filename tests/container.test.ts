/**
 * A course must never become a door into another course's assignments or files: the container
 * lookup is scoped to the course, and block payloads may only reference their own course.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/index.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { assignment, chapter, course, lesson, lessonBlock } from "../src/db/schema.ts";
import { containingLessons } from "../src/server/access/container.ts";
import { assertBlockReferences } from "../src/server/services/blocks.ts";

async function makeCourse(slug: string) {
  const [c] = await db
    .insert(course)
    .values({ slug, title: slug, language: "ca", status: "published" })
    .returning();
  const [ch] = await db
    .insert(chapter)
    .values({ courseId: c!.id, slug: "chapter", title: "Chapter" })
    .returning();
  const [l] = await db
    .insert(lesson)
    .values({ chapterId: ch!.id, slug: "lesson", title: "Lesson", status: "published" })
    .returning();
  return { course: c!, lesson: l! };
}

let a: Awaited<ReturnType<typeof makeCourse>>;
let b: Awaited<ReturnType<typeof makeCourse>>;
let essayId: string;

beforeAll(async () => {
  await runMigrations();
  a = await makeCourse("course-a");
  b = await makeCourse("course-b");
  const [essay] = await db
    .insert(assignment)
    .values({ courseId: a.course.id, title: "Essay" })
    .returning();
  essayId = essay!.id;
  // A's own block, and a block in course B pointing at A's assignment (written straight to the
  // table: the mutation refuses it, see below).
  await db.insert(lessonBlock).values([
    { lessonId: a.lesson.id, type: "assignment", payload: { assignment_id: essayId } },
    { lessonId: b.lesson.id, type: "assignment", payload: { assignment_id: essayId } },
  ]);
});

describe("containingLessons", () => {
  it("only counts blocks that live in the assignment's own course", async () => {
    const rows = await containingLessons("assignment", essayId, a.course.id);
    expect(rows.map((r) => r.lesson.id)).toEqual([a.lesson.id]);
  });
  it("finds nothing when the course has no block for it", async () => {
    const other = await makeCourse("course-c");
    expect(await containingLessons("assignment", essayId, other.course.id)).toEqual([]);
  });
});

describe("assertBlockReferences", () => {
  it("accepts the course's own assignment and rejects another course's", async () => {
    await expect(
      assertBlockReferences(db, "assignment", { assignment_id: essayId }, a.course.id),
    ).resolves.toBeUndefined();
    await expect(
      assertBlockReferences(db, "assignment", { assignment_id: essayId }, b.course.id),
    ).rejects.toThrow(/does not belong/);
    await expect(
      assertBlockReferences(db, "quiz", { quiz_id: crypto.randomUUID() }, b.course.id),
    ).rejects.toThrow(/does not belong/);
  });
  it("keeps file keys under the course prefix; empty drafts pass", async () => {
    const own = `courses/${a.course.id}/x.pdf`;
    await expect(assertBlockReferences(db, "file", { file_key: own }, a.course.id)).resolves.toBe(
      undefined,
    );
    await expect(
      assertBlockReferences(db, "audio", { file_key: own }, b.course.id),
    ).rejects.toThrow(/does not belong/);
    await expect(
      assertBlockReferences(db, "file", { file_key: "submissions/x/y/z.pdf" }, a.course.id),
    ).rejects.toThrow(/does not belong/);
    await expect(
      assertBlockReferences(db, "file", { file_key: "" }, b.course.id),
    ).resolves.toBeUndefined();
    await expect(assertBlockReferences(db, "text", { md: "hi" }, b.course.id)).resolves.toBe(
      undefined,
    );
  });
});
