import { inArray } from "drizzle-orm";
import { db } from "~/db";
import { file } from "~/db/schema";

/**
 * Course cover keys to the URL that serves them: `/api/files/<id>` checks access and redirects to
 * a short-lived signed URL, so the page never holds a storage URL. Server-only.
 */
export async function coverUrls(keys: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ id: file.id, key: file.key })
    .from(file)
    .where(inArray(file.key, wanted));
  return new Map(rows.map((r) => [r.key, `/api/files/${r.id}?inline=1`]));
}
