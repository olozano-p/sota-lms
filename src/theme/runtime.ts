/**
 * The process-wide theme: loaded from `THEME_DIR` on first use and kept. In development the files
 * are re-read at most once a second so edits to `theme.json`, `custom.css`, messages and emails
 * show on reload. Server-only; plain-Node safe.
 */
import { env } from "../config/env.ts";
import { loadTheme, type LoadedTheme } from "./load.ts";

let cached: { theme: LoadedTheme; at: number } | null = null;

export function getTheme(): LoadedTheme {
  const now = Date.now();
  if (!cached || (!env.isProduction && now - cached.at > 1000)) {
    cached = {
      theme: loadTheme(env.themeDir, { explicit: env.themeDirExplicit }),
      at: now,
    };
  }
  return cached.theme;
}

/** For tests that point `THEME_DIR` somewhere else between cases. */
export function resetThemeCache(): void {
  cached = null;
}
