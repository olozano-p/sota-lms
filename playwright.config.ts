import { defineConfig } from "@playwright/test";

/** Smoke suite against the docker compose stack (app on 3003, mock IdP on 3013). */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3003",
    trace: "retain-on-failure",
  },
  reporter: process.env.CI ? "github" : "list",
});
