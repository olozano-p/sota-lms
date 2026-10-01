/**
 * The operator's command line.
 *
 *   pnpm sota migrate                 apply database migrations (idempotent)
 *   pnpm sota seed                    demo course, cohort and mock-IdP users (development)
 *   pnpm sota create-admin [--email --name]   create or promote a local administrator
 *   pnpm sota validate-config         check .env and lms.config.ts, print a summary
 *   pnpm sota validate-theme          reserved for the theming phase
 *
 * In the container: `docker compose exec app node scripts/sota.ts <command>`.
 * Plain Node: relative imports with .ts extensions, no alias.
 */
export {};

const COMMANDS = ["migrate", "seed", "create-admin", "validate-config", "validate-theme"] as const;
type Command = (typeof COMMANDS)[number];

function usage(code: number): never {
  console.error(`usage: sota <${COMMANDS.join("|")}>`);
  process.exit(code);
}

const command = process.argv[2] as Command | undefined;
if (!command || !COMMANDS.includes(command)) usage(command ? 2 : 0);

// The delegated scripts parse their own arguments.
process.argv.splice(2, 1);

switch (command) {
  case "migrate": {
    const { runMigrations } = await import("../src/db/migrate.ts");
    await runMigrations();
    console.log("migrations applied");
    process.exit(0);
    break;
  }
  case "seed":
    await import("./seed.ts");
    break;
  case "create-admin":
    await import("./create-admin.ts");
    break;
  case "validate-config": {
    const { EnvError, parseEnv } = await import("../src/config/env.ts");
    const { checkDeployment } = await import("../src/config/check.ts");
    try {
      // `lms.config.ts` is parsed by `defineConfig` when it is imported.
      await import("../src/config/index.ts");
      const { summary, warnings } = checkDeployment(parseEnv());
      for (const line of summary) console.log(line);
      for (const w of warnings) console.warn(`warning: ${w}`);
      console.log(
        warnings.length ? "configuration is valid, with warnings" : "configuration is valid",
      );
      process.exit(0);
    } catch (e) {
      console.error(
        e instanceof EnvError ? e.message : `invalid configuration: ${(e as Error).message}`,
      );
      process.exit(1);
    }
    break;
  }
  case "validate-theme":
    console.error("validate-theme: not implemented yet (theming arrives in Phase 3)");
    process.exit(2);
}
