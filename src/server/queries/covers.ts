import { inArray } from "drizzle-orm";
import { db } from "~/db";
import { file } from "~/db/schema";

/**
 * Course cover keys to the URL that serves them: `/api/files/<id>` checks access and answers with
 * the 800 px WebP copy (`w`; full width of a phone card at 2×, the 300 px desktop card with room),
 * or redirects to a short-lived signed URL for a type it does not resize. Server-only.
 */
export async function coverUrls(keys: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ id: file.id, key: file.key })
    .from(file)
    .where(inArray(file.key, wanted));
  return new Map(rows.map((r) => [r.key, `/api/files/${r.id}?inline=1&w=800`]));
}
