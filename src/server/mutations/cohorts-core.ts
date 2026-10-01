/**
 * Drip rule expansion behind `cohorts.ts`. Kept apart from the server functions so that nothing
 * server-only is reachable from the client bundle through a plain export; callers authorise the
 * actor and own the transaction (CLAUDE.md invariants).
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { DbOrTx } from "~/db";
import { chapter, cohort, cohortRelease } from "~/db/schema";
import { lmsConfig } from "~/config";
import { dripSchedule } from "~/lib/drip";
import { audit } from "~/server/audit";
import type { SessionUser } from "~/server/auth/authz";

/**
 * Expands "N chapters every D days from the start" into one chapter-level `cohort_release` row per
 * chapter, replacing the cohort's earlier chapter releases (lesson-level ones stay). The rule
 * itself is not stored: access keeps reading the dates. Callers authorise and own the transaction.
 */
export async function applyDripRule(
  tx: DbOrTx,
  actor: Pick<SessionUser, "id">,
  input: {
    cohortId: string;
    everyDays: number;
    chaptersPerStep: number;
    /** `YYYY-MM-DD`; defaults to the cohort's `starts_at`. */
    startDate: string | null;
  },
) {
  const [g] = await tx.select().from(cohort).where(eq(cohort.id, input.cohortId)).limit(1);
  if (!g) throw new Error("cohort not found");
  const startDate = input.startDate ?? g.startsAt;
  if (!startDate) throw new Error("the cohort has no start date; give one");
  const chapters = await tx
    .select({ id: chapter.id })
    .from(chapter)
    .where(eq(chapter.courseId, g.courseId))
    .orderBy(asc(chapter.sort), asc(chapter.createdAt));
  const schedule = dripSchedule({
    chapterIds: chapters.map((c) => c.id),
    startDate,
    everyDays: input.everyDays,
    chaptersPerStep: input.chaptersPerStep,
    timeZone: lmsConfig.timeZone,
  });
  await tx
    .delete(cohortRelease)
    .where(and(eq(cohortRelease.cohortId, g.id), isNotNull(cohortRelease.chapterId)));
  const rows = schedule.length
    ? await tx
        .insert(cohortRelease)
        .values(schedule.map((r) => ({ cohortId: g.id, ...r })))
        .returning()
    : [];
  await audit(tx, {
    actorId: actor.id,
    action: "cohort.release.drip",
    entity: "cohort",
    entityId: g.id,
    after: {
      startDate,
      everyDays: input.everyDays,
      chaptersPerStep: input.chaptersPerStep,
      count: rows.length,
    },
  });
  return rows;
}
