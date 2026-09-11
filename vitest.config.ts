import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/*.test.ts"],
    // Modules that open the database at import time get an in-memory PGlite under test.
    env: { DATABASE_URL: "pglite://memory", SESSION_SECRET: "test-secret-test-secret-test-secret" },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
