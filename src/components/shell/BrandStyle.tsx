import type { LmsConfig } from "~/config";

/** Applies the deployment's accent overrides as CSS variables; the tokens stay semantic. */
export function brandStyle(colors: LmsConfig["brand"]["colors"]): string | null {
  const light: string[] = [];
  const dark: string[] = [];
  if (colors.primary) light.push(`--brand-primary:${colors.primary}`);
  if (colors.primaryForeground)
    light.push(`--brand-primary-foreground:${colors.primaryForeground}`);
  if (colors.link) light.push(`--brand-link:${colors.link}`);
  if (colors.primaryDark) dark.push(`--brand-primary:${colors.primaryDark}`);
  if (colors.primaryForegroundDark)
    dark.push(`--brand-primary-foreground:${colors.primaryForegroundDark}`);
  if (colors.linkDark) dark.push(`--brand-link:${colors.linkDark}`);
  if (!light.length && !dark.length) return null;
  return `${light.length ? `:root{${light.join(";")}}` : ""}${dark.length ? `.dark{${dark.join(";")}}` : ""}`;
}
