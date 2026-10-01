/**
 * The typed, validated environment (docs/configuration.md documents every variable). Parsed with
 * Zod on first use and by `validateEnv()` at boot, so a misconfigured deployment stops with one
 * readable message instead of failing on a request. Read lazily so that `vite build`, which
 * evaluates server modules without runtime secrets, never trips on a missing variable.
 * Plain-Node safe (no alias imports): it is also used by scripts and the production server.
 */
import { resolve } from "node:path";
import { z } from "zod";

export const AUTH_MODES = ["local", "oidc"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

const DEV_SESSION_SECRET = "sota-dev-secret-not-for-production";

/** Empty values (`KEY=` in a .env file) count as unset. */
const unset = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(unset, schema.optional());
const text = () => opt(z.string());

const flag = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z
      .enum(["true", "false", "1", "0", ""])
      .optional()
      .transform((v) => v === "true" || v === "1"),
  );

const rawSchema = z.object({
  NODE_ENV: text(),
  APP_URL: opt(z.url()),
  PORT: opt(z.coerce.number().int().min(1).max(65535)),
  DATABASE_URL: text(),
  SESSION_SECRET: text(),
  COOKIE_DOMAIN: text(),
  TRUST_PROXY: flag(),
  DEFAULT_LOCALE: opt(z.enum(["ca", "es", "en"])),
  THEME_DIR: text(),

  AUTH_MODE: opt(z.enum(AUTH_MODES)),
  ALLOW_SIGNUP: flag(),
  BREAK_GLASS_ADMIN_EMAIL: opt(z.email()),
  OIDC_ISSUER: opt(z.url()),
  OIDC_CLIENT_ID: text(),
  OIDC_CLIENT_SECRET: text(),
  OIDC_SCOPES: text(),
  OIDC_ROLES_CLAIM: text(),
  OIDC_END_SESSION_URL: opt(z.url()),
  ENTITLEMENT_CLAIM: text(),

  ENTITLEMENTS_PULL_URL: opt(z.url()),
  ENTITLEMENTS_PULL_TOKEN: text(),
  ENTITLEMENTS_WEBHOOK_SECRET: text(),

  STORAGE_DRIVER: opt(z.enum(["local", "s3"])),
  STORAGE_DIR: text(),
  S3_ENDPOINT: text(),
  S3_PUBLIC_ENDPOINT: text(),
  S3_REGION: text(),
  S3_BUCKET: text(),
  S3_ACCESS_KEY_ID: text(),
  S3_SECRET_ACCESS_KEY: text(),
  S3_FORCE_PATH_STYLE: flag(),

  MAIL_TRANSPORT: opt(z.enum(["console", "smtp"])),
  MAIL_FROM: text(),
  SMTP_HOST: text(),
  SMTP_PORT: opt(z.coerce.number().int().min(1).max(65535)),
  SMTP_SECURE: flag(),
  SMTP_USER: text(),
  SMTP_PASSWORD: text(),

  VIMEO_ACCESS_TOKEN: text(),
  NOTIFY_INTERVAL_MS: opt(z.coerce.number().int().min(0)),
});

type Raw = z.infer<typeof rawSchema>;

/** Variables that must be present for a given condition, checked after the shape is valid. */
function missing(raw: Raw, names: (keyof Raw)[]): string[] {
  return names.filter((n) => !raw[n]);
}

export class EnvError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Invalid environment configuration (see .env.example and docs/configuration.md):\n${problems
        .map((p) => `  - ${p}`)
        .join("\n")}`,
    );
    this.name = "EnvError";
    this.problems = problems;
  }
}

export function parseEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const raw = parsed.data;
  const problems: string[] = [];
  const isProduction = raw.NODE_ENV === "production";
  const authMode: AuthMode = raw.AUTH_MODE ?? "local";
  const storageDriver = raw.STORAGE_DRIVER ?? "local";
  const mailTransport = raw.MAIL_TRANSPORT ?? "console";

  if (authMode === "oidc") {
    for (const n of missing(raw, ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]))
      problems.push(`${n} is required when AUTH_MODE=oidc`);
  }
  if (isProduction) {
    if (!raw.SESSION_SECRET || raw.SESSION_SECRET.length < 32)
      problems.push("SESSION_SECRET must be set to at least 32 characters in production");
    if (!raw.STORAGE_DIR && storageDriver === "local")
      problems.push("STORAGE_DIR is required in production with STORAGE_DRIVER=local");
  }
  if (storageDriver === "s3") {
    for (const n of missing(raw, ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]))
      problems.push(`${n} is required when STORAGE_DRIVER=s3`);
  }
  if (mailTransport === "smtp" && !raw.SMTP_HOST)
    problems.push("SMTP_HOST is required when MAIL_TRANSPORT=smtp");
  if (raw.BREAK_GLASS_ADMIN_EMAIL && authMode !== "oidc")
    problems.push("BREAK_GLASS_ADMIN_EMAIL only applies with AUTH_MODE=oidc");
  if (problems.length) throw new EnvError(problems);

  const port = raw.PORT ?? 3003;
  return {
    isProduction,
    port,
    appUrl: (raw.APP_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    databaseUrl: raw.DATABASE_URL ?? "postgres://sota:sota@localhost:5433/sota",
    sessionSecret: raw.SESSION_SECRET ?? DEV_SESSION_SECRET,
    cookieDomain: raw.COOKIE_DOMAIN ?? null,
    trustProxy: raw.TRUST_PROXY,
    defaultLocale: raw.DEFAULT_LOCALE ?? null,
    /** Directory of theme.json, custom.css, messages, emails, assets and slots (docs/theming.md). */
    themeDir: resolve(raw.THEME_DIR ?? "theme"),
    /** `THEME_DIR` was set: a missing directory is then an error rather than "use the defaults". */
    themeDirExplicit: raw.THEME_DIR !== undefined,
    authMode,
    /** Local signup is a `local`-mode feature; OIDC never registers anyone. */
    allowSignup: authMode === "local" && raw.ALLOW_SIGNUP,
    breakGlassAdminEmail: raw.BREAK_GLASS_ADMIN_EMAIL?.toLowerCase() ?? null,
    oidc: {
      issuer: (raw.OIDC_ISSUER ?? "").replace(/\/$/, ""),
      clientId: raw.OIDC_CLIENT_ID ?? "",
      clientSecret: raw.OIDC_CLIENT_SECRET ?? "",
      scopes: (raw.OIDC_SCOPES ?? "openid profile email").split(/[\s,]+/).filter(Boolean),
      rolesClaim: raw.OIDC_ROLES_CLAIM ?? "roles",
      endSessionUrl: raw.OIDC_END_SESSION_URL ?? null,
      entitlementClaim: raw.ENTITLEMENT_CLAIM ?? null,
    },
    entitlements: {
      pullUrl: raw.ENTITLEMENTS_PULL_URL?.replace(/\/$/, "") ?? null,
      pullToken: raw.ENTITLEMENTS_PULL_TOKEN ?? null,
      webhookSecret: raw.ENTITLEMENTS_WEBHOOK_SECRET ?? null,
    },
    storage: {
      driver: storageDriver,
      dir: resolve(raw.STORAGE_DIR ?? "data/uploads"),
    },
    s3: {
      endpoint: raw.S3_ENDPOINT ?? null,
      publicEndpoint: raw.S3_PUBLIC_ENDPOINT ?? null,
      region: raw.S3_REGION ?? "us-east-1",
      bucket: raw.S3_BUCKET ?? "",
      accessKeyId: raw.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: raw.S3_SECRET_ACCESS_KEY ?? "",
      forcePathStyle: raw.S3_FORCE_PATH_STYLE,
    },
    mail: {
      transport: mailTransport,
      from: raw.MAIL_FROM ?? "SOTA <lms@example.invalid>",
      smtp: {
        host: raw.SMTP_HOST ?? "",
        port: raw.SMTP_PORT ?? 587,
        secure: raw.SMTP_SECURE,
        user: raw.SMTP_USER ?? null,
        password: raw.SMTP_PASSWORD ?? null,
      },
    },
    vimeoAccessToken: raw.VIMEO_ACCESS_TOKEN ?? null,
    notifyIntervalMs: raw.NOTIFY_INTERVAL_MS ?? 15 * 60 * 1000,
  };
}

export type Env = ReturnType<typeof parseEnv>;

let cached: Env | null = null;

/** Parses once; throws an `EnvError` listing every problem. Call at boot to fail fast. */
export function validateEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** For tests that change `process.env` between cases. */
export function resetEnvCache(): void {
  cached = null;
}

/** Lazy view over the validated environment: nothing is parsed until a property is read. */
export const env: Env = new Proxy({} as Env, {
  get: (_t, key: string) => validateEnv()[key as keyof Env],
  has: (_t, key: string) => key in validateEnv(),
  ownKeys: () => Reflect.ownKeys(validateEnv()),
  getOwnPropertyDescriptor: (_t, key) => ({
    enumerable: true,
    configurable: true,
    value: validateEnv()[key as keyof Env],
  }),
});
