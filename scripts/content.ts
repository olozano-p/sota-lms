/**
 * `pnpm sota export <dir>` and `pnpm sota import <dir>` (ADR-021): courses, chapters, lessons,
 * blocks, assignments, quizzes and (optionally) cohorts with their drip releases as JSON plus the
 * media they reference, in a plain directory. Never people, enrollments, submissions or progress.
 *
 *   sota export <dir> [--course <slug>]... [--all] [--cohorts] [--force]
 *   sota import <dir> [--dry-run] [--draft]
 *
 * Plain Node: relative imports with .ts extensions, no alias.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BundleError } from "../src/lib/content-bundle.ts";

const version = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

export async function runContent(command: "export" | "import", args: string[]): Promise<never> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      course: { type: "string", multiple: true },
      all: { type: "boolean" },
      cohorts: { type: "boolean" },
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
      draft: { type: "boolean" },
    },
  });
  const dir = positionals[0];
  try {
    if (!dir) throw new Error(`usage: sota ${command} <directory>`);
    const { validateEnv } = await import("../src/config/env.ts");
    validateEnv();
    const { db } = await import("../src/db/index.ts");
    const { getObject, headObject, putObject } =
      await import("../src/server/services/storage/index.ts");
    const { readBundleDir, writeBundleDir } =
      await import("../src/server/services/content-bundle-dir.ts");

    if (command === "export") {
      if (!values.all && !values.course?.length)
        throw new Error("say what to export: --course <slug> (repeatable) or --all");
      const { exportContent } = await import("../src/server/queries/content-export-core.ts");
      const result = await exportContent(
        db,
        { getObject },
        {
          courses: values.all ? "all" : values.course!,
          cohorts: values.cohorts === true,
          version,
        },
      );
      await writeBundleDir(dir, result.bundle, result.files, { force: values.force === true });
      for (const w of result.warnings) console.warn(`warning: ${w}`);
      const lessons = result.bundle.courses.reduce(
        (n, c) => n + c.chapters.reduce((m, ch) => m + ch.lessons.length, 0),
        0,
      );
      console.log(
        `exported ${result.bundle.courses.length} course(s), ${lessons} lesson(s) and ${result.bundle.media.length} media file(s) to ${dir}`,
      );
      process.exit(0);
    }

    const { importContent, cliActor } =
      await import("../src/server/mutations/content-import-core.ts");
    const { lmsConfig } = await import("../src/config/index.ts");
    const { bundle, files } = await readBundleDir(dir);
    const dryRun = values["dry-run"] === true;
    const report = await importContent(
      db,
      cliActor(),
      bundle,
      files,
      { headObject, putObject },
      {
        dryRun,
        draft: values.draft === true,
        maxBytes: lmsConfig.uploads.maxBytes,
        allowedMime: lmsConfig.uploads.allowedMime,
      },
    );
    for (const w of report.warnings) console.warn(`warning: ${w}`);
    const t = (x: { created: number; updated: number; unchanged: number }) =>
      `${x.created} created, ${x.updated} updated, ${x.unchanged} unchanged`;
    for (const c of report.courses) {
      console.log(`course ${c.slug}: ${c.op}`);
      console.log(`  chapters ${t(c.chapters)}`);
      console.log(`  lessons ${t(c.lessons)}; block lists replaced in ${c.blocksReplaced}`);
      console.log(`  assignments ${t(c.assignments)}; quizzes ${t(c.quizzes)}`);
      if (c.cohorts.created + c.cohorts.updated + c.cohorts.unchanged)
        console.log(`  cohorts ${t(c.cohorts)}; releases ${t(c.releases)}`);
      console.log(`  media ${c.media.uploaded} stored, ${c.media.reused} already there`);
    }
    console.log(dryRun ? "dry run: nothing was written" : "import complete");
    process.exit(0);
  } catch (e) {
    console.error(
      e instanceof BundleError ? e.message : `${command} failed: ${(e as Error).message}`,
    );
    process.exit(1);
  }
}
