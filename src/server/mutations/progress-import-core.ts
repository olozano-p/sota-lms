/**
 * Writes a progress file (`src/lib/progress-file.ts`, ADR-023) into `lesson_progress`: the lesson
 * completions a school brings from another LMS. Runs from `pnpm sota import-progress`, where the
 * operator's shell and `DATABASE_URL` are the credential (the `cliActor()` of the content import,
 * ADR-021); nothing here is reachable from a request.
 *
 * Each line names a learner (`sub` and/or `email`) and a course; the learner is found by `sub` under
 * the configured issuer, else by the sub-keyed placeholder `adoptSubPlaceholder` merges at sign-in,
 * else by email, else (oidc mode only) created as the same placeholder the service API creates.
 * A completion is inserted, or upgrades a started row; a completed row is never touched, so a re-run
 * changes nothing and an earlier completion is never moved. Unknown courses, chapters and lessons
 * are skipped and reported. No enrollment is created: access stays with the enrollment source.
 * One transaction; `dryRun` runs it and rolls it back. Plain-Node safe.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/index.ts";
import { chapter, lesson, lessonProgress, person } from "../../db/schema.ts";
import type { ProgressLine, ProgressRecord } from "../../lib/progress-file.ts";
import { loadRefs } from "../access/refs.ts";
import { audit, capDetail } from "../audit.ts";
import { insertPlaceholderPerson } from "../auth/identity.ts";
import type { ContentActor } from "./content-import-core.ts";

export interface ProgressImportOptions {
  dryRun: boolean;
  /** Placeholders are created only in `oidc` mode; in `local` mode an unknown learner is skipped. */
  authMode: "local" | "oidc";
  /** `OIDC_ISSUER`: a `sub` matches a signed-in person only under this issuer. */
  issuer: string;
}

export interface ProgressSkip {
  line: number;
  /** `course`, or `course/chapter/lesson`. */
  ref: string;
  reason: string;
}

export interface ProgressImportReport {
  dryRun: boolean;
  lines: number;
  people: { matched: number; created: number };
  lessons: {
    /** New completed rows. */
    created: number;
    /** Started rows marked completed. */
    completed: number;
    /** Already completed: left as they were. */
    unchanged: number;
    skipped: number;
  };
  skipped: ProgressSkip[];
}

class DryRunRollback extends Error {
  report: ProgressImportReport;
  constructor(report: ProgressImportReport) {
    super("dry run");
    this.report = report;
  }
}

type PersonRow = typeof person.$inferSelect;
type Resolved =
  | { ok: true; row: PersonRow; created: boolean; adoptedSub: boolean }
  | { ok: false; reason: string };

/**
 * Who a line is about. A `sub` matches the person signed in under `issuer`, else the placeholder
 * that carries it (`external_iss` null); an email matches anyone with that address, who adopts the
 * sub when they have none (as the service API and the pull do). In `oidc` mode a learner not found
 * becomes a placeholder adopted at their first sign-in: by email through account linking, by `sub`
 * through `adoptSubPlaceholder`.
 */
async function resolvePerson(
  tx: DbOrTx,
  r: ProgressRecord,
  opts: ProgressImportOptions,
): Promise<Resolved> {
  const email = r.email?.toLowerCase();
  if (r.sub) {
    const rows = await tx.select().from(person).where(eq(person.externalSub, r.sub));
    const hit =
      rows.find((p) => opts.issuer !== "" && p.externalIss === opts.issuer) ??
      rows.find((p) => p.externalIss === null);
    if (hit) return { ok: true, row: hit, created: false, adoptedSub: false };
  }
  if (email) {
    const [byEmail] = await tx
      .select()
      .from(person)
      .where(sql`lower(${person.email}) = ${email}`)
      .limit(1);
    if (byEmail) {
      if (r.sub && byEmail.externalSub && byEmail.externalSub !== r.sub)
        return { ok: false, reason: "the email belongs to a person with another sub" };
      if (r.sub && !byEmail.externalSub) {
        const [row] = await tx
          .update(person)
          .set({ externalSub: r.sub })
          .where(eq(person.id, byEmail.id))
          .returning();
        return { ok: true, row: row!, created: false, adoptedSub: true };
      }
      return { ok: true, row: byEmail, created: false, adoptedSub: false };
    }
  }
  if (opts.authMode !== "oidc")
    return { ok: false, reason: "no such person (AUTH_MODE is local: create the account first)" };
  const row = await insertPlaceholderPerson(tx, { sub: r.sub, email, name: r.name });
  if (!row) return { ok: false, reason: "the sub's placeholder address is already in use" };
  return { ok: true, row, created: true, adoptedSub: false };
}

/** `chapter slug` + `lesson slug` → lesson id, for one course. */
async function lessonIndex(tx: DbOrTx, courseId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: lesson.id, lessonSlug: lesson.slug, chapterSlug: chapter.slug })
    .from(lesson)
    .innerJoin(chapter, eq(chapter.id, lesson.chapterId))
    .where(eq(chapter.courseId, courseId));
  return new Map(rows.map((l) => [`${l.chapterSlug}/${l.lessonSlug}`, l.id]));
}

export async function importProgress(
  db: Db,
  actor: ContentActor,
  lines: ProgressLine[],
  opts: ProgressImportOptions,
): Promise<ProgressImportReport> {
  try {
    return await db.transaction(async (tx) => {
      const report: ProgressImportReport = {
        dryRun: opts.dryRun,
        lines: lines.length,
        people: { matched: 0, created: 0 },
        lessons: { created: 0, completed: 0, unchanged: 0, skipped: 0 },
        skipped: [],
      };
      const refs = await loadRefs(
        tx,
        lines.map((l) => ({ course: l.record.course })),
      );
      const indexes = new Map<string, Map<string, string>>();
      const seen = new Set<string>();

      for (const { line, record: r } of lines) {
        const skip = (ref: string, reason: string, lessons = 1) => {
          report.skipped.push({ line, ref, reason });
          report.lessons.skipped += lessons;
        };
        const c = refs.course(r.course);
        if (!c) {
          skip(r.course, "unknown course", r.lessons.length);
          continue;
        }
        let index = indexes.get(c.id);
        if (!index) indexes.set(c.id, (index = await lessonIndex(tx, c.id)));

        // Of a lesson listed twice, the earlier completion counts.
        const wanted = new Map<string, Date>();
        for (const l of r.lessons) {
          const lessonId = index.get(`${l.chapter}/${l.lesson}`);
          if (!lessonId) {
            skip(`${r.course}/${l.chapter}/${l.lesson}`, "unknown chapter or lesson");
            continue;
          }
          const at = new Date(l.completed_at);
          const held = wanted.get(lessonId);
          if (!held || at < held) wanted.set(lessonId, at);
        }
        if (!wanted.size) continue;

        const who = await resolvePerson(tx, r, opts);
        if (!who.ok) {
          skip(r.course, who.reason, wanted.size);
          continue;
        }
        const personId = who.row.id;
        if (!seen.has(personId)) {
          seen.add(personId);
          if (who.created) report.people.created++;
          else report.people.matched++;
        }

        const before = new Map(
          (
            await tx
              .select({ lessonId: lessonProgress.lessonId, status: lessonProgress.status })
              .from(lessonProgress)
              .where(
                and(
                  eq(lessonProgress.personId, personId),
                  inArray(lessonProgress.lessonId, [...wanted.keys()]),
                ),
              )
          ).map((p) => [p.lessonId, p.status]),
        );
        const counts = { created: 0, completed: 0, unchanged: 0 };
        for (const lessonId of wanted.keys()) {
          const status = before.get(lessonId);
          if (status === "completed") counts.unchanged++;
          else if (status) counts.completed++;
          else counts.created++;
        }
        report.lessons.created += counts.created;
        report.lessons.completed += counts.completed;
        report.lessons.unchanged += counts.unchanged;
        if (counts.created + counts.completed === 0 && !who.created && !who.adoptedSub) continue;

        if (counts.created + counts.completed > 0)
          await tx
            .insert(lessonProgress)
            .values(
              [...wanted].map(([lessonId, at]) => ({
                personId,
                lessonId,
                status: "completed" as const,
                completedAt: at,
                updatedAt: at,
              })),
            )
            .onConflictDoUpdate({
              target: [lessonProgress.personId, lessonProgress.lessonId],
              set: {
                status: "completed",
                completedAt: sql`excluded.completed_at`,
                updatedAt: sql`greatest(${lessonProgress.updatedAt}, excluded.updated_at)`,
              },
              // A completed row is never rewritten: not its status, not its date.
              setWhere: sql`${lessonProgress.status} <> 'completed'`,
            });
        await audit(tx, {
          actorId: null,
          actor: actor.label,
          action: "progress.import",
          entity: "person",
          entityId: personId,
          after: {
            line,
            course: r.course,
            ...(who.created ? { person: { placeholderCreated: true } } : {}),
            ...(who.adoptedSub ? { person: { adoptedSub: true } } : {}),
            ...counts,
            ...capDetail(
              [...wanted]
                .filter(([lessonId]) => before.get(lessonId) !== "completed")
                .map(([lessonId, at]) => ({
                  lessonId,
                  op: before.has(lessonId) ? "completed" : "created",
                  completedAt: at,
                })),
            ),
          },
        });
      }
      if (opts.dryRun) throw new DryRunRollback(report);
      return report;
    });
  } catch (e) {
    if (e instanceof DryRunRollback) return e.report;
    throw e;
  }
}
