/**
 * Lesson blocks: payload validation (used by the editor) and resolution into what the player
 * renders (signed file URLs, provider embeds, sanitised HTML). Server-only.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "~/db";
import { assignment, file, quiz, type BlockType } from "~/db/schema";
import { lmsConfig } from "~/config";
import { renderMarkdown } from "~/lib/markdown";
import { videoProvider } from "./video";

export const blockPayloadSchemas = {
  text: z.object({ md: z.string() }),
  video: z.object({
    provider: z.string().min(1),
    external_id: z.string().min(1),
    title: z.string(),
    duration_s: z.number().nullable(),
    thumbnail_url: z.string().nullable().optional(),
  }),
  audio: z.object({
    file_key: z.string().min(1),
    title: z.string(),
    duration_s: z.number().nullable(),
  }),
  file: z.object({
    file_key: z.string().min(1),
    title: z.string(),
    mime: z.string(),
    size: z.number().int().nonnegative(),
  }),
  assignment: z.object({ assignment_id: z.string().uuid() }),
  quiz: z.object({ quiz_id: z.string().uuid() }),
  embed: z.object({ url: z.string().url(), title: z.string().nullable().optional() }),
} satisfies Record<BlockType, z.ZodTypeAny>;

/**
 * References inside a payload must stay inside the block's course: an assignment or quiz of
 * another course, or an object under another course's (or a submission's) storage prefix, would
 * otherwise become reachable through this lesson. Empty values are drafts and pass.
 */
export async function assertBlockReferences(
  tx: DbOrTx,
  type: BlockType,
  payload: Record<string, unknown>,
  courseId: string,
): Promise<void> {
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  if ((type === "audio" || type === "file") && str("file_key")) {
    if (!str("file_key").startsWith(`courses/${courseId}/`))
      throw new Error("file does not belong to this course");
  }
  if (type === "assignment" && str("assignment_id")) {
    const [a] = await tx
      .select({ courseId: assignment.courseId })
      .from(assignment)
      .where(eq(assignment.id, str("assignment_id")))
      .limit(1);
    if (a?.courseId !== courseId) throw new Error("assignment does not belong to this course");
  }
  if (type === "quiz" && str("quiz_id")) {
    const [q] = await tx
      .select({ courseId: quiz.courseId })
      .from(quiz)
      .where(eq(quiz.id, str("quiz_id")))
      .limit(1);
    if (q?.courseId !== courseId) throw new Error("quiz does not belong to this course");
  }
}

export function embedAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return lmsConfig.embedAllowlist.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export type ResolvedBlock =
  | { id: string; sort: number; type: "text"; html: string }
  | {
      id: string;
      sort: number;
      type: "video";
      provider: string;
      iframeSrc: string;
      title: string;
      durationS: number | null;
    }
  | {
      id: string;
      sort: number;
      type: "audio";
      url: string | null;
      title: string;
      durationS: number | null;
    }
  | {
      id: string;
      sort: number;
      type: "file";
      url: string | null;
      title: string;
      mime: string;
      size: number;
    }
  | { id: string; sort: number; type: "embed"; url: string; title: string | null; allowed: boolean }
  | { id: string; sort: number; type: "assignment"; assignmentId: string; title: string | null }
  | {
      id: string;
      sort: number;
      type: "quiz";
      quizId: string;
      title: string | null;
      kind: "form" | "self_check" | null;
    };

type Row = { id: string; sort: number; type: BlockType; payload: unknown };

/** Files are served through `/api/files/$fileId`, which re-checks access and signs a short URL. */
export async function resolveBlocks(rows: Row[]): Promise<ResolvedBlock[]> {
  const keys = new Set<string>();
  const assignmentIds = new Set<string>();
  const quizIds = new Set<string>();
  for (const r of rows) {
    const p = r.payload as Record<string, unknown>;
    if ((r.type === "audio" || r.type === "file") && typeof p.file_key === "string")
      keys.add(p.file_key);
    if (r.type === "assignment" && typeof p.assignment_id === "string")
      assignmentIds.add(p.assignment_id);
    if (r.type === "quiz" && typeof p.quiz_id === "string") quizIds.add(p.quiz_id);
  }
  const [files, assignments, quizzes] = await Promise.all([
    keys.size
      ? db
          .select({ id: file.id, key: file.key })
          .from(file)
          .where(inArray(file.key, [...keys]))
      : [],
    assignmentIds.size
      ? db
          .select({ id: assignment.id, title: assignment.title })
          .from(assignment)
          .where(inArray(assignment.id, [...assignmentIds]))
      : [],
    quizIds.size
      ? db
          .select({ id: quiz.id, title: quiz.title, kind: quiz.kind })
          .from(quiz)
          .where(inArray(quiz.id, [...quizIds]))
      : [],
  ]);
  const fileByKey = new Map(files.map((f) => [f.key, f.id]));
  const urlFor = (key: string) => (fileByKey.has(key) ? `/api/files/${fileByKey.get(key)}` : null);

  return rows.map((r): ResolvedBlock => {
    const base = { id: r.id, sort: r.sort };
    switch (r.type) {
      case "text": {
        const p = blockPayloadSchemas.text.parse(r.payload);
        return { ...base, type: "text", html: renderMarkdown(p.md) };
      }
      case "video": {
        const p = blockPayloadSchemas.video.parse(r.payload);
        const embed = videoProvider(p.provider).embed(p.external_id);
        return {
          ...base,
          type: "video",
          provider: p.provider,
          iframeSrc: embed.iframeSrc,
          title: p.title,
          durationS: p.duration_s,
        };
      }
      case "audio": {
        const p = blockPayloadSchemas.audio.parse(r.payload);
        return {
          ...base,
          type: "audio",
          url: urlFor(p.file_key),
          title: p.title,
          durationS: p.duration_s,
        };
      }
      case "file": {
        const p = blockPayloadSchemas.file.parse(r.payload);
        return {
          ...base,
          type: "file",
          url: urlFor(p.file_key),
          title: p.title,
          mime: p.mime,
          size: p.size,
        };
      }
      case "embed": {
        const p = blockPayloadSchemas.embed.parse(r.payload);
        return {
          ...base,
          type: "embed",
          url: p.url,
          title: p.title ?? null,
          allowed: embedAllowed(p.url),
        };
      }
      case "assignment": {
        const p = blockPayloadSchemas.assignment.parse(r.payload);
        return {
          ...base,
          type: "assignment",
          assignmentId: p.assignment_id,
          title: assignments.find((a) => a.id === p.assignment_id)?.title ?? null,
        };
      }
      case "quiz": {
        const p = blockPayloadSchemas.quiz.parse(r.payload);
        const q = quizzes.find((x) => x.id === p.quiz_id);
        return {
          ...base,
          type: "quiz",
          quizId: p.quiz_id,
          title: q?.title ?? null,
          kind: q?.kind ?? null,
        };
      }
    }
  });
}

/** Whether a lesson counts as media-only (completes itself at 90 % playback). */
export function isMediaOnly(rows: { type: BlockType }[]): boolean {
  return rows.length > 0 && rows.every((r) => r.type === "video" || r.type === "audio");
}

export { eq };
