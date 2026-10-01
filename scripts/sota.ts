/**
 * The operator's command line.
 *
 *   pnpm sota migrate                 apply database migrations (idempotent)
 *   pnpm sota seed                    demo course, cohort and mock-IdP users (development)
 *   pnpm sota create-admin [--email --name]   create or promote a local administrator
 *   pnpm sota validate-config         check .env and lms.config.ts, print a summary
 *   pnpm sota validate-theme [dir] [--strict]   check THEME_DIR (or dir): theme.json, messages, emails,
 *                                     assets, slots; --strict also fails on warnings
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
    const { logger } = await import("../src/lib/log.ts");
    await runMigrations();
    logger.info("migrations applied");
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
      const env = parseEnv();
      const { summary, warnings } = checkDeployment(env);
      const { loadTheme } = await import("../src/theme/load.ts");
      const theme = loadTheme(env.themeDir, { explicit: env.themeDirExplicit });
      summary.push(
        `theme: ${theme.config.name} (${theme.exists ? env.themeDir : "shipped defaults"})`,
      );
      warnings.push(...theme.warnings.map((w) => `theme: ${w}`));
      const { lmsConfig } = await import("../src/config/index.ts");
      if (!lmsConfig.locales.enabled.includes(theme.config.defaultLocale))
        warnings.push(
          `theme defaultLocale "${theme.config.defaultLocale}" is not enabled in lms.config.ts: "${lmsConfig.locales.enabled[0]}" is used`,
        );
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
  case "validate-theme": {
    const { EnvError, parseEnv } = await import("../src/config/env.ts");
    const { ThemeError, loadTheme } = await import("../src/theme/load.ts");
    const { SLOT_NAMES } = await import("../src/theme/schema.ts");
    const args = process.argv.slice(2);
    const strict = args.includes("--strict");
    const given = args.find((a) => !a.startsWith("--"));
    try {
      const env = parseEnv();
      const { resolve } = await import("node:path");
      const dir = given ? resolve(given) : env.themeDir;
      const theme = loadTheme(dir, { explicit: given !== undefined || env.themeDirExplicit });
      const c = theme.config;
      console.log(
        `theme: ${c.name} (${theme.exists ? dir : `${dir} not found, shipped defaults`})`,
      );
      console.log(`default language: ${c.defaultLocale}`);
      console.log(
        `messages: ${Object.entries(theme.messages)
          .map(([l, m]) => `${l} ${Object.keys(m).length}`)
          .join(", ")} overridden`,
      );
      console.log(
        `email templates: ${Object.keys(theme.emails.byName).join(", ") || "none (shipped layout)"}`,
      );
      console.log(`assets: ${theme.assets.length} file(s)`);
      console.log(
        `slots: ${theme.slots.length ? theme.slots.join(", ") : "none"} of ${SLOT_NAMES.length} (slots are compiled in at build time, not read at runtime)`,
      );
      console.log(`stylesheet: ${theme.css.length} bytes, hash ${theme.cssHash}`);
      for (const w of theme.warnings) console.warn(`warning: ${w}`);
      if (strict && theme.warnings.length) {
        console.error("theme has warnings and --strict was given");
        process.exit(1);
      }
      console.log(theme.warnings.length ? "theme is valid, with warnings" : "theme is valid");
      process.exit(0);
    } catch (e) {
      console.error(
        e instanceof ThemeError || e instanceof EnvError
          ? e.message
          : `invalid theme: ${(e as Error).message}`,
      );
      process.exit(1);
    }
    break;
  }
}
