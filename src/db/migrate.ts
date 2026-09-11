/**
 * Applies the Drizzle migrations. Idempotent: the explicit deploy step and the CI dry-run.
 *
 *   pnpm db:migrate
 *
 * Runs under plain Node (`node src/db/migrate.ts`).
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { db, isPglite, type Db } from "./index.ts";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function runMigrations(database: Db = db): Promise<void> {
  if (isPglite) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(database as Parameters<typeof migrate>[0], { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(database as Parameters<typeof migrate>[0], { migrationsFolder });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runMigrations();
  console.log("migrations applied");
  process.exit(0);
}
