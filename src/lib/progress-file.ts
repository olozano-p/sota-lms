/**
 * The progress file (`sota-progress/v1`, ADR-023): one JSON object per line, one learner and one
 * course each, listing the lessons that learner completed elsewhere. It is how a school moving
 * from another LMS brings completions along; `pnpm sota import-progress` reads it. References are
 * the course's slug or `external_ref` and the chapter and lesson slugs inside it, never database
 * ids. Pure and plain-Node safe: the import and the tests share it.
 */
import { z } from "zod";

export const PROGRESS_FORMAT = "sota-progress";
export const PROGRESS_VERSION = 1;

/** References are not held to the slug grammar: one that matches nothing is skipped, not refused. */
const ref = z.string().min(1).max(200);

const completionSchema = z.strictObject({
  chapter: ref,
  lesson: ref,
  completed_at: z.string().datetime({ offset: true }),
});

export const progressRecordSchema = z
  .strictObject({
    format: z.literal(PROGRESS_FORMAT),
    version: z.literal(PROGRESS_VERSION),
    /** The OIDC subject (`person.external_sub`); the key in `oidc` mode. */
    sub: z.string().min(1).max(255).optional(),
    email: z.email().max(320).optional(),
    name: z.string().min(1).max(200).optional(),
    /** Course slug or `external_ref`. */
    course: ref,
    lessons: z.array(completionSchema).max(10_000),
  })
  .refine((r) => r.sub !== undefined || r.email !== undefined, {
    message: "sub or email is required",
  });
export type ProgressRecord = z.infer<typeof progressRecordSchema>;

/** A record and the line it came from, so the report can point back into the file. */
export interface ProgressLine {
  line: number;
  record: ProgressRecord;
}

export class ProgressFileError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid progress file:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ProgressFileError";
    this.problems = problems;
  }
}

/** Most problems one error lists; a file that is wrong throughout says so in the last entry. */
const MAX_PROBLEMS = 50;

/**
 * Parses a JSON Lines text (blank lines ignored) and validates every line before anything is
 * written. Throws a `ProgressFileError` listing the problems with their line numbers.
 */
export function parseProgressFile(text: string): ProgressLine[] {
  const out: ProgressLine[] = [];
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    const line = i + 1;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      problems.push(`line ${line}: not valid JSON`);
      continue;
    }
    const parsed = progressRecordSchema.safeParse(value);
    if (parsed.success) out.push({ line, record: parsed.data });
    else
      for (const issue of parsed.error.issues)
        problems.push(`line ${line}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  if (!problems.length && !out.length) problems.push("the file holds no records");
  if (problems.length > MAX_PROBLEMS)
    throw new ProgressFileError([
      ...problems.slice(0, MAX_PROBLEMS),
      `and ${problems.length - MAX_PROBLEMS} more`,
    ]);
  if (problems.length) throw new ProgressFileError(problems);
  return out;
}
