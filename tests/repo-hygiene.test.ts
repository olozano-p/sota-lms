import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("compose.yml", () => {
  const compose = readFileSync(new URL("../compose.yml", import.meta.url), "utf8");
  it("takes the image from SOTA_IMAGE with a generic placeholder default", () => {
    expect(compose).toMatch(/image:\s*\$\{SOTA_IMAGE:-ghcr\.io\/OWNER\/sota:latest\}/);
  });
});

describe("plain-Node modules", () => {
  // Vitest transpiles everything; Node's native type stripping is stricter (no enums, no parameter
  // properties, explicit .ts extensions). Loading the modules the CLI and the image run proves it.
  const modules = [
    "src/lib/log.ts",
    "src/lib/content-bundle.ts",
    "src/server/audit.ts",
    "src/server/services/content-bundle-dir.ts",
    "src/server/queries/content-export-core.ts",
    "src/server/mutations/content-import-core.ts",
    "scripts/content.ts",
  ];
  it("load under node without a bundler", () => {
    const root = new URL("..", import.meta.url).pathname;
    const code = modules.map((m) => `await import(${JSON.stringify(`${root}${m}`)});`).join("\n");
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: "pglite://memory", NODE_OPTIONS: "" },
      stdio: "pipe",
    });
  });
});

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Source files of the application and its tooling, without tests and the development mock IdP. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.|\.gen\./.test(name)) out.push(rel);
  }
  return out;
}

describe("docs/configuration.md", () => {
  const doc = read("docs/configuration.md");
  const names = new Set<string>();
  for (const f of [...sources("src"), ...sources("scripts"), "lms.config.ts"]) {
    for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]!);
  }
  for (const m of read("src/config/env.ts").matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)) names.add(m[1]!);
  for (const f of ["compose.yml"])
    for (const m of read(f).matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)) names.add(m[1]!);
  for (const m of read("Dockerfile").matchAll(/^ENV ([A-Z][A-Z0-9_]+)=/gm)) names.add(m[1]!);
  for (const m of read("Dockerfile").matchAll(/\$\{([A-Z][A-Z0-9_]+):-/g)) names.add(m[1]!);

  it("documents every environment variable the code, Compose and the image read", () => {
    expect(names.size).toBeGreaterThan(40);
    const undocumented = [...names].filter((n) => !doc.includes(n)).sort();
    expect(undocumented).toEqual([]);
  });
  it(".env.example lists every variable the schema validates", () => {
    const example = read(".env.example");
    const schema = [...read("src/config/env.ts").matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map(
      (m) => m[1]!,
    );
    // NODE_ENV is set by the image; the deprecated alias is deliberately left out of the template.
    const left = new Set(["NODE_ENV", "ENTITLEMENTS_WEBHOOK_SECRET"]);
    const missing = schema.filter(
      (n) => !left.has(n) && !new RegExp(`^#?\\s*${n}=`, "m").test(example),
    );
    expect(missing).toEqual([]);
  });
});

describe("no deployment-specific names", () => {
  // Words that would tie the repository to one organisation, person or site. Generic fixtures use
  // example.invalid; the project's own name is not in this list.
  const forbidden = ["virupa", "contemplativ", "artscontem"];
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(join(root, dir))) {
      if (
        [
          "node_modules",
          ".git",
          "dist",
          ".output",
          ".tanstack",
          "data",
          "test-results",
          "playwright-report",
          ".claude",
        ].includes(name)
      )
        continue;
      const rel = dir ? `${dir}/${name}` : name;
      if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
      else if (
        !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|pdf|mp3|lock|tgz)$/i.test(name) &&
        name !== "pnpm-lock.yaml"
      )
        out.push(rel);
    }
    return out;
  }
  it("appears nowhere in tracked source, docs, config or fixtures", () => {
    const hits: string[] = [];
    for (const f of walk("")) {
      if (f === "tests/repo-hygiene.test.ts" || f === ".env") continue;
      const text = read(f).toLowerCase();
      for (const w of forbidden) if (text.includes(w)) hits.push(`${f}: ${w}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("release workflow", () => {
  const wf = read(".github/workflows/release.yml");
  it("publishes to GHCR on a version tag after CI, under the repository owner", () => {
    expect(wf).toMatch(/tags:\s*\["v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
    expect(wf).toContain("uses: ./.github/workflows/ci.yml");
    expect(wf).toMatch(/needs:\s*ci/);
    expect(wf).toContain("GITHUB_REPOSITORY_OWNER");
    expect(wf).toMatch(/ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER,,\}\/sota/);
    expect(wf).toContain("type=semver,pattern={{version}}");
    expect(wf).toContain("flavor: latest=auto");
    expect(wf).toContain("packages: write");
    expect(wf).toMatch(/package\.json version/);
    expect(read(".github/workflows/ci.yml")).toContain("workflow_call:");
  });
  it("is the image compose.yml and the docs point at", () => {
    expect(read("docs/deploying.md")).toContain("ghcr.io/<owner>/sota");
    expect(read("compose.yml")).toContain("ghcr.io/OWNER/sota:latest");
  });
});
