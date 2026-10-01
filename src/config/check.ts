/** What `sota validate-config` reports about a parsed environment. Plain-Node safe. */
import type { Env } from "./env.ts";

export function checkDeployment(env: Env): { summary: string[]; warnings: string[] } {
  const summary = [
    `auth mode: ${env.authMode}`,
    `public url: ${env.appUrl}`,
    `storage: ${env.storage.driver}${env.storage.driver === "local" ? ` (${env.storage.dir})` : ` (bucket ${env.s3.bucket})`}`,
    `mail: ${env.mail.transport}`,
  ];
  const warnings: string[] = [];
  if (env.isProduction) {
    if (env.mail.transport === "console")
      warnings.push(
        "MAIL_TRANSPORT=console: confirmation, invitation and magic links are only printed to the log; set MAIL_TRANSPORT=smtp for real users",
      );
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(env.appUrl))
      warnings.push(
        "APP_URL points at localhost: links in emails and the OIDC redirect will break",
      );
    if (env.authMode === "local" && env.allowSignup && env.mail.transport === "console")
      warnings.push("ALLOW_SIGNUP=true with console mail: nobody can confirm their address");
  }
  return { summary, warnings };
}
