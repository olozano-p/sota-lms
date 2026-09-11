/**
 * Typed access to the environment. Read lazily so that `vite build` (which evaluates server
 * modules without runtime secrets) never fails on a missing variable; production fails loudly at
 * the first use instead. Server-only: never import from a component.
 */
const isProduction = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (.env.example)`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value ? value : null;
}

export const env = {
  isProduction,
  get port(): number {
    return Number(process.env.PORT ?? 3003);
  },
  get appUrl(): string {
    return (process.env.APP_URL ?? `http://localhost:${this.port}`).replace(/\/$/, "");
  },
  get databaseUrl(): string {
    return process.env.DATABASE_URL ?? "postgres://lodro:lodro@localhost:5433/lodro";
  },
  get sessionSecret(): string {
    return isProduction
      ? required("SESSION_SECRET")
      : (process.env.SESSION_SECRET ?? "lodro-dev-secret-not-for-production");
  },
  get cookieDomain(): string | null {
    return optional("COOKIE_DOMAIN");
  },
  oidc: {
    get issuer(): string {
      return required("OIDC_ISSUER");
    },
    get clientId(): string {
      return required("OIDC_CLIENT_ID");
    },
    get clientSecret(): string {
      return required("OIDC_CLIENT_SECRET");
    },
    get endSessionUrl(): string | null {
      return optional("OIDC_END_SESSION_URL");
    },
    get rolesClaim(): string {
      return process.env.OIDC_ROLES_CLAIM ?? "roles";
    },
  },
  entitlements: {
    get pullUrl(): string {
      return required("ENTITLEMENTS_PULL_URL").replace(/\/$/, "");
    },
    get pullToken(): string {
      return required("ENTITLEMENTS_PULL_TOKEN");
    },
    get webhookSecret(): string {
      return required("ENTITLEMENTS_WEBHOOK_SECRET");
    },
  },
  s3: {
    get endpoint(): string | null {
      return optional("S3_ENDPOINT");
    },
    get region(): string {
      return process.env.S3_REGION ?? "us-east-1";
    },
    get bucket(): string {
      return required("S3_BUCKET");
    },
    get accessKeyId(): string {
      return required("S3_ACCESS_KEY_ID");
    },
    get secretAccessKey(): string {
      return required("S3_SECRET_ACCESS_KEY");
    },
    get forcePathStyle(): boolean {
      return process.env.S3_FORCE_PATH_STYLE === "true";
    },
  },
  mail: {
    get transport(): "console" | "smtp" {
      return process.env.MAIL_TRANSPORT === "smtp" ? "smtp" : "console";
    },
    get from(): string {
      return process.env.MAIL_FROM ?? "Lodrö <lms@example.invalid>";
    },
    get smtp() {
      return {
        host: required("SMTP_HOST"),
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        user: optional("SMTP_USER"),
        password: optional("SMTP_PASSWORD"),
      };
    },
  },
  get vimeoAccessToken(): string | null {
    return optional("VIMEO_ACCESS_TOKEN");
  },
} as const;
