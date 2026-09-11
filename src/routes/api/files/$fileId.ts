import { createFileRoute } from "@tanstack/react-router";
import { eq, or, sql } from "drizzle-orm";
import { db } from "~/db";
import { file, lessonBlock, submission } from "~/db/schema";
import { AuthorizationError, currentUser, hasRole } from "~/server/auth/authz";
import { requireLessonAccess } from "~/server/access/require";
import { signedGetUrl } from "~/server/services/files";

/**
 * The only way to a stored object: find who references the file, check that the caller may see
 * that thing, then 302 to a ≤ 5-minute signed URL. `?inline=1` streams (audio, PDFs in the browser).
 */
export const Route = createFileRoute("/api/files/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await currentUser();
        if (!user) return new Response("sign in required", { status: 401 });
        const [f] = await db.select().from(file).where(eq(file.id, params.fileId)).limit(1);
        if (!f) return new Response("not found", { status: 404 });

        const blocks = await db
          .select({ lessonId: lessonBlock.lessonId })
          .from(lessonBlock)
          .where(or(sql`${lessonBlock.payload}->>'file_key' = ${f.key}`))
          .limit(5);
        let allowed = false;
        for (const b of blocks) {
          try {
            await requireLessonAccess(user, b.lessonId);
            allowed = true;
            break;
          } catch (e) {
            if (!(e instanceof AuthorizationError)) throw e;
          }
        }
        if (!allowed) {
          // A submission's file: its author, the course's teachers and admins.
          const [s] = await db
            .select({ personId: submission.personId })
            .from(submission)
            .where(eq(submission.fileKey, f.key))
            .limit(1);
          if (s && (s.personId === user.id || hasRole(user, "teacher", "admin"))) allowed = true;
          if (!allowed && f.uploadedBy === user.id) allowed = true;
        }
        if (!allowed) return new Response("forbidden", { status: 403 });

        const inline = new URL(request.url).searchParams.get("inline") === "1";
        const url = await signedGetUrl(f.key, f.filename, f.mime, inline);
        return new Response(null, {
          status: 302,
          headers: { location: url, "cache-control": "private, no-store" },
        });
      },
    },
  },
});
