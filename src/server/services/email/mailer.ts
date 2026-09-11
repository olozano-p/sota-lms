/**
 * SMTP through nodemailer, or a console transport in development. Plain-Node safe (relative
 * imports) so the notification tick can run outside the bundle.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../../config/env.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;

function transport(): Transporter {
  if (transporter) return transporter;
  if (env.mail.transport === "smtp") {
    const { host, port, secure, user, password } = env.mail.smtp;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password ?? "" } : undefined,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export async function sendMail(mail: Mail): Promise<void> {
  const info = await transport().sendMail({ from: env.mail.from, ...mail });
  if (env.mail.transport === "console") {
    console.log(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    void info;
  }
}
