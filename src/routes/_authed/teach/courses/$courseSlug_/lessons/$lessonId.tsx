import { useState } from "react";
import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Plus, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n";
import { BLOCK_TYPES, LESSON_STATUSES, type BlockType } from "~/db/schema";
import { getLessonEditor } from "~/server/queries/teach";
import {
  createBlock,
  deleteBlock,
  deleteLesson,
  reorderBlocks,
  updateBlock,
  updateLesson,
} from "~/server/mutations/authoring";
import { BlockEditor, type EditableBlock } from "~/components/editor/BlockEditor";
import { SortableList } from "~/components/editor/SortableList";
import { SaveIndicator } from "~/components/editor/SaveIndicator";
import { useAutosave } from "~/components/editor/useAutosave";
import { Button, buttonVariants } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Empty } from "~/components/ui/empty";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug_/lessons/$lessonId")({
  loader: async ({ params }) => {
    const data = await getLessonEditor({ data: { lessonId: params.lessonId } });
    if (!data || data.course.slug !== params.courseSlug) throw notFound();
    return data;
  },
  component: LessonEditorPage,
});

function LessonEditorPage() {
  const data = Route.useLoaderData();
  return <LessonEditor key={`${data.lesson.id}:${data.blocks.length}`} data={data} />;
}

function LessonEditor({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getLessonEditor>>>;
}) {
  const { t } = useI18n();
  const { course, chapter, chapters, lesson, assignments, quizzes, uploads, embedAllowlist } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const { state, run } = useAutosave();
  const mUpdateLesson = useServerFn(updateLesson);
  const mDeleteLesson = useServerFn(deleteLesson);
  const mCreateBlock = useServerFn(createBlock);
  const mUpdateBlock = useServerFn(updateBlock);
  const mDeleteBlock = useServerFn(deleteBlock);
  const mReorderBlocks = useServerFn(reorderBlocks);
  const [blocks, setBlocks] = useState<EditableBlock[]>(() =>
    data.blocks.map((b) => ({ ...b, payload: JSON.parse(b.payload) as Record<string, unknown> })),
  );
  const [deletingLesson, setDeletingLesson] = useState(false);
  const [deletingBlock, setDeletingBlock] = useState<string | null>(null);
  const [newType, setNewType] = useState<BlockType>("text");

  const refresh = () => router.invalidate();
  const patchLesson = (p: Parameters<typeof updateLesson>[0]["data"]["patch"]) =>
    run(() => mUpdateLesson({ data: { lessonId: lesson.id, patch: p } })).then(refresh);
  const saveBlock = (b: EditableBlock) =>
    run(() => mUpdateBlock({ data: { blockId: b.id, payload: b.payload } }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          to="/teach/courses/$courseSlug"
          params={{ courseSlug: course.slug }}
          className="text-sm"
        >
          ← {course.title} · {t("teach.lesson.backToCourse")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl">{lesson.title}</h1>
          <div className="flex items-center gap-2">
            <SaveIndicator state={state} />
            <Link
              to="/courses/$courseSlug/$lessonSlug"
              params={{ courseSlug: course.slug, lessonSlug: lesson.slug }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "text-foreground no-underline hover:no-underline",
              )}
            >
              <Eye aria-hidden="true" />
              {t("teach.lesson.preview")}
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patchLesson({ status: lesson.status === "published" ? "draft" : "published" })
              }
            >
              {lesson.status === "published" ? t("teach.unpublish") : t("teach.publish")}
            </Button>
          </div>
        </div>
      </div>

      <section className="grid gap-5 rounded-lg border bg-card p-5 lg:grid-cols-3">
        <Field label={t("teach.lesson.title")} className="lg:col-span-2">
          {(c) => (
            <Input
              {...c}
              defaultValue={lesson.title}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value.trim() !== lesson.title &&
                patchLesson({ title: e.target.value.trim() })
              }
            />
          )}
        </Field>
        <Field label={t("teach.settings.status")}>
          {(c) => (
            <Select
              {...c}
              value={lesson.status}
              onChange={(e) =>
                patchLesson({ status: e.target.value as (typeof LESSON_STATUSES)[number] })
              }
            >
              {LESSON_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`teach.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("teach.lesson.summary")}
          hint={t("teach.lesson.summary.hint")}
          className="lg:col-span-2"
        >
          {(c) => (
            <Input
              {...c}
              defaultValue={lesson.summary ?? ""}
              onBlur={(e) =>
                (e.target.value.trim() || null) !== lesson.summary &&
                patchLesson({ summary: e.target.value.trim() || null })
              }
            />
          )}
        </Field>
        <Field label={t("teach.lesson.minutes")}>
          {(c) => (
            <Input
              {...c}
              type="number"
              min={0}
              defaultValue={lesson.estimatedMinutes ?? ""}
              onBlur={(e) =>
                (e.target.value === "" ? null : Number(e.target.value)) !==
                  lesson.estimatedMinutes &&
                patchLesson({
                  estimatedMinutes: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          )}
        </Field>
        <Field label={t("teach.lesson.slug")} hint={t("teach.settings.slug.hint")}>
          {(c) => (
            <Input
              {...c}
              defaultValue={lesson.slug}
              className="font-mono"
              onBlur={(e) =>
                e.target.value !== lesson.slug && patchLesson({ slug: e.target.value })
              }
            />
          )}
        </Field>
        <Field label={t("teach.lesson.chapter")}>
          {(c) => (
            <Select
              {...c}
              value={chapter.id}
              onChange={(e) => patchLesson({ chapterId: e.target.value })}
            >
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end lg:justify-end">
          <Button variant="ghost" size="sm" onClick={() => setDeletingLesson(true)}>
            <Trash2 aria-hidden="true" />
            {t("teach.lesson.delete")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        {blocks.length === 0 ? <Empty title={t("teach.block.empty")} /> : null}
        <SortableList
          items={blocks}
          onReorder={(ids) => {
            setBlocks(ids.map((id) => blocks.find((b) => b.id === id)!));
            run(() => mReorderBlocks({ data: { lessonId: lesson.id, orderedIds: ids } }));
          }}
          renderItem={(b) => (
            <BlockEditor
              block={b}
              courseId={course.id}
              uploads={uploads}
              embedAllowlist={embedAllowlist}
              assignments={assignments}
              quizzes={quizzes}
              onChange={(payload) =>
                setBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, payload } : x)))
              }
              onSave={() => {
                setBlocks((prev) => {
                  const current = prev.find((x) => x.id === b.id);
                  if (current) void saveBlock(current);
                  return prev;
                });
              }}
              onDelete={() => setDeletingBlock(b.id)}
            />
          )}
        />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(() => mCreateBlock({ data: { lessonId: lesson.id, type: newType } }));
            await refresh();
          }}
        >
          <Field label={t("teach.block.add")}>
            {(c) => (
              <Select
                {...c}
                value={newType}
                onChange={(e) => setNewType(e.target.value as BlockType)}
                className="w-48"
              >
                {BLOCK_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`teach.block.type.${ty}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="outline">
            <Plus aria-hidden="true" />
            {t("common.add")}
          </Button>
        </form>
      </section>

      <ConfirmDialog
        open={deletingBlock !== null}
        title={t("teach.block.delete")}
        confirmLabel={t("common.delete")}
        destructive
        onClose={() => setDeletingBlock(null)}
        onConfirm={async () => {
          if (!deletingBlock) return;
          await run(() => mDeleteBlock({ data: { blockId: deletingBlock } }));
          setDeletingBlock(null);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={deletingLesson}
        title={t("teach.lesson.delete")}
        description={t("teach.lesson.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        onClose={() => setDeletingLesson(false)}
        onConfirm={async () => {
          await run(() => mDeleteLesson({ data: { lessonId: lesson.id } }));
          await navigate({ to: "/teach/courses/$courseSlug", params: { courseSlug: course.slug } });
        }}
      />
    </div>
  );
}
