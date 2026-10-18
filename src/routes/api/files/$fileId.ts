import { createFileRoute } from "@tanstack/react-router";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { assignment, course, file, lessonBlock, submission } from "~/db/schema";
import { AuthorizationError, currentUser } from "~/server/auth/authz";
import {
  decideCourse,
  enrolledCourses,
  isPrivileged,
  loadPersonFacts,
  requireLessonAccess,
} from "~/server/access/require";
import { requireForumFileAccess } from "~/server/access/forum";
import { forumScopeFromFileKey } from "~/lib/forum";
import {
  isResizable,
  signedGetUrl,
  storedImageVariant,
  VARIANT_VERSION,
  variantWidth,
} from "~/server/services/storage";
import { errorFields, logger } from "~/lib/log";

/**
 * A JPEG, PNG or WebP asked for with `?w=`: its WebP display copy, served here rather than through a
 * signed URL so the address is stable and the browser can keep it. `no-cache` plus the ETag means
 * every view still passes the access check above, but an unchanged image costs a 304, not its bytes.
 * Null (the caller falls back to the redirect) when the original is missing or cannot be decoded.
 */
async function serveVariant(
  request: Request,
  f: { id: string; key: string; size: number; filename: string },
  width: number,
): Promise<Response | null> {
  const etag = `"${f.id}-${f.size}-w${width}-v${VARIANT_VERSION}"`;
  const headers = new Headers({
    etag,
    "cache-control": "private, no-cache",
    "content-type": "image/webp",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.filename.replace(/\.[^.]*$/, "") + ".webp")}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  const sent = request.headers.get("if-none-match");
  if (sent && sent.split(",").some((t) => t.trim().replace(/^W\//, "") === etag))
    return new Response(null, { status: 304, headers });
  let body: Uint8Array | null;
  try {
    body = await storedImageVariant(f.key, width);
  } catch (e) {
    logger.warn("image variant failed", { fileId: f.id, width, ...errorFields(e) });
    return null;
  }
  if (!body) return null;
  headers.set("content-length", String(body.byteLength));
  return new Response(body as BodyInit, { status: 200, headers });
}

/**
 * The only way to a stored object: find who references the file, check that the caller may see
 * that thing, then 302 to a ≤ 5-minute signed URL. `?inline=1` streams (audio, PDFs in the browser);
 * `?w=<px>` on an image serves its resized WebP copy directly (`serveVariant`).
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
          .where(sql`${lessonBlock.payload}->>'file_key' = ${f.key}`);
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
          // A submission's file: its author, the teachers of that course and admins.
          const [s] = await db
            .select({ personId: submission.personId, courseId: assignment.courseId })
            .from(submission)
            .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
            .where(eq(submission.fileKey, f.key))
            .limit(1);
          if (s) {
            if (s.personId === user.id) allowed = true;
            else allowed = isPrivileged(await loadPersonFacts(user), s.courseId);
          }
          if (!allowed && f.uploadedBy === user.id) allowed = true;
        }
        if (!allowed) {
          // An image placed inside rich text (`courses/<id>/inline/…`): anyone who may open the
          // course right now. Block files keep the per-lesson decision above.
          const courseId = f.key.match(/^courses\/([0-9a-f-]{36})\/inline\//)?.[1];
          const [c] = courseId
            ? await db.select().from(course).where(eq(course.id, courseId)).limit(1)
            : [];
          if (c) {
            const facts = await loadPersonFacts(user);
            allowed = isPrivileged(facts, c.id) || decideCourse(facts, c).ok;
          }
        }
        if (!allowed) {
          // A course cover: whoever has the course among their courses (the same filter that
          // decides which cards `/courses` shows) and its teachers.
          const [c] = await db
            .select()
            .from(course)
            .where(eq(course.coverImageKey, f.key))
            .limit(1);
          if (c) {
            const facts = await loadPersonFacts(user);
            allowed = isPrivileged(facts, c.id) || enrolledCourses(facts, [c]).length > 0;
          }
        }
        if (!allowed) {
          // A forum image: whoever may read that forum.
          const scope = forumScopeFromFileKey(f.key);
          if (scope) {
            try {
              await requireForumFileAccess(user, scope);
              allowed = true;
            } catch (e) {
              if (!(e instanceof AuthorizationError)) throw e;
            }
          }
        }
        if (!allowed) return new Response("forbidden", { status: 403 });

        const search = new URL(request.url).searchParams;
        const width = variantWidth(search.get("w"));
        if (width && isResizable(f.mime)) {
          const served = await serveVariant(request, f, width);
          if (served) return served;
        }

        const inline = search.get("inline") === "1";
        const url = await signedGetUrl(f.key, f.filename, f.mime, inline);
        return new Response(null, {
          status: 302,
          headers: { location: url, "cache-control": "private, no-store" },
        });
      },
    },
  },
});
