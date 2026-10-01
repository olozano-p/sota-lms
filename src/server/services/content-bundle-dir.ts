/**
 * A content bundle on disk: `sota-export.json` next to a `media/` directory (ADR-021). A plain
 * directory because it needs no dependency and every tool can pack it (`tar czf`, `zip -r`).
 * Reads refuse anything that leaves the directory, symbolic links included. Plain-Node safe.
 */
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { BUNDLE_FILE, BundleError, parseBundle, type Bundle } from "../../lib/content-bundle.ts";

export async function writeBundleDir(
  dir: string,
  bundle: Bundle,
  files: Map<string, Uint8Array>,
  opts: { force: boolean },
): Promise<void> {
  const root = resolve(dir);
  const manifest = join(root, BUNDLE_FILE);
  const exists = await stat(manifest).then(
    () => true,
    () => false,
  );
  if (exists && !opts.force)
    throw new Error(`${manifest} already exists: choose another directory or pass --force`);
  await mkdir(root, { recursive: true });
  for (const [path, body] of files) {
    const target = resolve(root, path);
    if (!target.startsWith(root + sep))
      throw new Error(`refusing to write outside ${root}: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  await writeFile(manifest, `${JSON.stringify(bundle, null, 2)}\n`);
}

/** Parses the manifest and loads the media files it lists whose size matches; the importer verifies the rest. */
export async function readBundleDir(
  dir: string,
): Promise<{ bundle: Bundle; files: Map<string, Uint8Array> }> {
  const root = await realpath(resolve(dir)).catch(() => {
    throw new Error(`${dir} is not a directory`);
  });
  let raw: string;
  try {
    raw = await readFile(join(root, BUNDLE_FILE), "utf8");
  } catch {
    throw new Error(`${join(root, BUNDLE_FILE)} not found: is this an export directory?`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BundleError([`${BUNDLE_FILE} is not valid JSON`]);
  }
  const bundle = parseBundle(json);
  const files = new Map<string, Uint8Array>();
  for (const m of bundle.media) {
    const real = await realpath(join(root, m.path)).catch(() => null);
    if (!real || !real.startsWith(root + sep)) continue;
    if ((await stat(real)).size !== m.size) continue;
    files.set(m.path, await readFile(real));
  }
  return { bundle, files };
}
