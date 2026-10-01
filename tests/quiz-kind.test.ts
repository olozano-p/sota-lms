import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const { db } = await import("../src/db/index.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const s = await import("../src/db/schema.ts");

let courseId: string;
beforeAll(async () => {
  await runMigrations();
  const [c] = await db
    .insert(s.course)
    .values({ slug: "qk", title: "QK", language: "en", status: "published" })
    .returning();
  courseId = c!.id;
});

describe("quiz.kind check constraint", () => {
  it("accepts form and self_check", async () => {
    for (const kind of s.QUIZ_KINDS)
      await db.insert(s.quiz).values({ courseId, title: kind, kind });
  });
  it("rejects any other value at the database", async () => {
    await expect(
      db.execute(
        sql`insert into quiz (id, course_id, title, kind) values (gen_random_uuid(), ${courseId}, 'x', 'quiz')`,
      ),
    ).rejects.toThrow();
  });
});
