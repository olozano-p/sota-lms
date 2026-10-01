/**
 * Compiles theme slots into the bundle (ADR-019). For each slot name the virtual module
 * `virtual:sota-theme-slots` imports `<THEME_DIR>/slots/<Name>.tsx` when it exists and otherwise
 * `src/theme/default/slots/<Name>.tsx`, so the app always has exactly one component per slot and no
 * runtime fallback logic. Runs inside Vite (the config process), not in the app.
 */
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { searchForWorkspaceRoot, type Plugin } from "vite";
import { DEFAULT_THEME_DIR, loadTheme } from "./load.ts";
import { SLOT_NAMES } from "./schema.ts";

const VIRTUAL = "virtual:sota-theme-slots";
const RESOLVED = `\0${VIRTUAL}`;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const inside = (file: string, dir: string) => {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

export function sotaTheme(options: { themeDir: string; explicit: boolean }): Plugin {
  const themeDir = resolve(options.themeDir);
  // Fail the dev server or the build with the readable message, not later on a request.
  const theme = loadTheme(themeDir, { explicit: options.explicit });
  const source = Object.fromEntries(
    SLOT_NAMES.map((name) => [
      name,
      theme.slots.includes(name)
        ? join(themeDir, "slots", `${name}.tsx`)
        : join(DEFAULT_THEME_DIR, "slots", `${name}.tsx`),
    ]),
  );
  const outsideRepo = !inside(themeDir, REPO);

  return {
    name: "sota-theme-slots",
    config() {
      return {
        // A theme outside the repository must still be readable by the dev server.
        server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), themeDir] } },
      };
    },
    async resolveId(id, importer, opts) {
      if (id === VIRTUAL) return RESOLVED;
      // A slot kept outside the repository has no node_modules of its own: resolve its bare and
      // `~/` imports as if it lived in the repository.
      if (
        importer &&
        outsideRepo &&
        inside(importer, themeDir) &&
        !id.startsWith(".") &&
        !isAbsolute(id) &&
        !id.startsWith("\0")
      ) {
        const target = id.startsWith("~/") ? join(REPO, "src", id.slice(2)) : id;
        return this.resolve(target, join(REPO, "package.json"), { ...opts, skipSelf: true });
      }
      return null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const imports = SLOT_NAMES.map((n) => `import ${n} from ${JSON.stringify(source[n])};`);
      const origin = Object.fromEntries(
        SLOT_NAMES.map((n) => [n, theme.slots.includes(n) ? "theme" : "default"]),
      );
      return `${imports.join("\n")}
export const slots = { ${SLOT_NAMES.join(", ")} };
export const slotOrigin = ${JSON.stringify(origin)};
`;
    },
    configureServer(server) {
      // A new or removed slot file changes the module graph: tell the developer instead of lying.
      server.watcher.add(join(themeDir, "slots"));
      const warn = (f: string) => {
        if (inside(f, join(themeDir, "slots")) && f.endsWith(".tsx"))
          server.config.logger.warn(`theme slot ${f} added or removed: restart the dev server`);
      };
      server.watcher.on("add", warn).on("unlink", warn);
    },
  };
}
