/**
 * One database handle per process. `DATABASE_URL=pglite://memory` (vitest) opens an in-memory
 * PGlite through the same Drizzle schema; anything else is a `pg` pool. Server-only.
 * Runs under plain Node too (migrate, seed): relative imports with .ts extensions.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema.ts";

/**
 * Typed as the node-postgres flavour; the PGlite handle used in tests has the same query API and
 * is cast to it, so callers never branch on the driver.
 */
export type Db = NodePgDatabase<typeof schema>;
/** Either the db or a transaction handle: what queries and mutations accept. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const url = process.env.DATABASE_URL ?? "postgres://sota:sota@localhost:5433/sota";
export const isPglite = url.startsWith("pglite://");

async function open(): Promise<Db> {
  if (isPglite) {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = new PGlite();
    return drizzlePglite({ client, schema, casing: "snake_case" }) as unknown as Db;
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzlePg({ client: pool, schema, casing: "snake_case" });
}

export const db: Db = await open();
export { schema };
