import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://sota:sota@localhost:5433/sota",
  },
  strict: true,
  verbose: true,
} satisfies Config;
