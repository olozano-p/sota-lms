import { z } from "zod";

const emailSchema = z.email();

/**
 * Splits pasted text (one address per line, or separated by commas, semicolons or spaces; an
 * `Name <a@b.c>` form is accepted) into unique lower-case addresses and the tokens that are not one.
 */
export function parseEmailList(text: string): { emails: string[]; invalid: string[] } {
  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.replace(/^[<"']+|[>"']+$/g, "").toLowerCase();
    if (!token) continue;
    if (emailSchema.safeParse(token).success) emails.add(token);
    else invalid.push(raw);
  }
  return { emails: [...emails], invalid };
}
