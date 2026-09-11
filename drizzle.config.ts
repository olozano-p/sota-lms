import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://lodro:lodro@localhost:5433/lodro",
  },
  strict: true,
  verbose: true,
} satisfies Config;
