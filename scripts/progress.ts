/**
 * `pnpm sota import-progress <file.jsonl> [--dry-run]` (ADR-023): lesson completions brought from
 * another LMS, one learner and course per line (`sota-progress/v1`, docs/progress-import.md).
 * Never creates enrollments; never rewrites a completed lesson.
 *
 * Plain Node: relative imports with .ts extensions, no alias.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ProgressFileError, parseProgressFile } from "../src/lib/progress-file.ts";

/** Most skipped references printed; the rest are counted. */
const SKIPS_SHOWN = 200;

export async function runProgressImport(args: string[]): Promise<never> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { "dry-run": { type: "boolean" } },
  });
  const path = positionals[0];
  try {
    if (!path) throw new Error("usage: sota import-progress <file.jsonl> [--dry-run]");
    const lines = parseProgressFile(await readFile(path, "utf8"));
    const { validateEnv } = await import("../src/config/env.ts");
    const env = validateEnv();
    const { db } = await import("../src/db/index.ts");
    const { cliActor } = await import("../src/server/mutations/content-import-core.ts");
    const { importProgress } = await import("../src/server/mutations/progress-import-core.ts");
    const dryRun = values["dry-run"] === true;
    const report = await importProgress(db, cliActor(), lines, {
      dryRun,
      authMode: env.authMode,
      issuer: env.oidc.issuer,
    });
    const { people: p, lessons: l } = report;
    console.log(`read ${report.lines} record(s)`);
    console.log(`people: ${p.matched} found, ${p.created} placeholder(s) created`);
    console.log(
      `lessons: ${l.created} created, ${l.completed} marked completed, ${l.unchanged} already completed, ${l.skipped} skipped`,
    );
    for (const s of report.skipped.slice(0, SKIPS_SHOWN))
      console.log(`  skipped line ${s.line} ${s.ref}: ${s.reason}`);
    if (report.skipped.length > SKIPS_SHOWN)
      console.log(`  and ${report.skipped.length - SKIPS_SHOWN} more skipped reference(s)`);
    console.log(dryRun ? "dry run: nothing was written" : "import complete");
    process.exit(0);
  } catch (e) {
    console.error(
      e instanceof ProgressFileError
        ? e.message
        : `import-progress failed: ${(e as Error).message}`,
    );
    process.exit(1);
  }
}
