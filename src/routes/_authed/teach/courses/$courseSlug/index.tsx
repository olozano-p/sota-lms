import { useState } from "react";
import { createFileRoute, Link, useRouter, getRouteApi } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n";
import {
  createChapter,
  createLesson,
  deleteChapter,
  reorderChapters,
  reorderLessons,
  updateChapter,
  updateLesson,
} from "~/server/mutations/authoring";
import { SortableList } from "~/components/editor/SortableList";
import { SaveIndicator } from "~/components/editor/SaveIndicator";
import { useAutosave } from "~/components/editor/useAutosave";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Empty } from "~/components/ui/empty";

const parent = getRouteApi("/_authed/teach/courses/$courseSlug");

export const Route = createFileRoute("/_authed/teach/courses/$courseSlug/")({
  component: StructurePage,
});

function StructurePage() {
  const { t } = useI18n();
  const { course, chapters } = parent.useLoaderData();
  const router = useRouter();
  const { state, run } = useAutosave();
  const mCreateChapter = useServerFn(createChapter);
  const mUpdateChapter = useServerFn(updateChapter);
  const mDeleteChapter = useServerFn(deleteChapter);
  const mReorderChapters = useServerFn(reorderChapters);
  const mCreateLesson = useServerFn(createLesson);
  const mUpdateLesson = useServerFn(updateLesson);
  const mReorderLessons = useServerFn(reorderLessons);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newChapter, setNewChapter] = useState("");
  const [newLesson, setNewLesson] = useState<Record<string, string>>({});

  const refresh = () => router.invalidate();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end">
        <SaveIndicator state={state} />
      </div>
      {chapters.length === 0 ? <Empty title={t("common.empty")} /> : null}
      <SortableList
        items={chapters}
        onReorder={(ids) =>
          run(() => mReorderChapters({ data: { courseId: course.id, orderedIds: ids } })).then(
            refresh,
          )
        }
        renderItem={(ch) => (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t("teach.chapter.title")}
                defaultValue={ch.title}
                className="max-w-md font-medium"
                onBlur={(e) => {
                  const title = e.target.value.trim();
                  if (title && title !== ch.title)
                    run(() =>
                      mUpdateChapter({ data: { chapterId: ch.id, patch: { title } } }),
                    ).then(refresh);
                }}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("syllabus.lessons", { n: ch.lessons.length })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("teach.chapter.delete")}
                onClick={() => setDeleting(ch.id)}
                className="ml-auto"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            {ch.lessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("teach.chapter.empty")}</p>
            ) : null}
            <SortableList
              items={ch.lessons}
              className="pl-2"
              onReorder={(ids) =>
                run(() => mReorderLessons({ data: { chapterId: ch.id, orderedIds: ids } })).then(
                  refresh,
                )
              }
              renderItem={(l) => (
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to="/teach/courses/$courseSlug/lessons/$lessonId"
                    params={{ courseSlug: course.slug, lessonId: l.id }}
                    className="min-w-0 flex-1 truncate font-medium text-foreground"
                  >
                    {l.title}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("teach.lesson.blocks", { n: l.blockCount })}
                  </span>
                  <Badge variant={l.status === "published" ? "success" : "warning"}>
                    {t(`teach.status.${l.status}`)}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      run(() =>
                        mUpdateLesson({
                          data: {
                            lessonId: l.id,
                            patch: { status: l.status === "published" ? "draft" : "published" },
                          },
                        }),
                      ).then(refresh)
                    }
                  >
                    {l.status === "published" ? t("teach.unpublish") : t("teach.publish")}
                  </Button>
                </div>
              )}
            />
            <form
              className="flex gap-2 pl-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const title = (newLesson[ch.id] ?? "").trim();
                if (!title) return;
                await run(() => mCreateLesson({ data: { chapterId: ch.id, title } }));
                setNewLesson({ ...newLesson, [ch.id]: "" });
                await refresh();
              }}
            >
              <Input
                aria-label={t("teach.lesson.title")}
                placeholder={t("teach.lesson.new")}
                value={newLesson[ch.id] ?? ""}
                onChange={(e) => setNewLesson({ ...newLesson, [ch.id]: e.target.value })}
                className="max-w-sm"
              />
              <Button type="submit" variant="outline" size="default">
                <Plus aria-hidden="true" />
                {t("teach.lesson.add")}
              </Button>
            </form>
          </div>
        )}
      />
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = newChapter.trim();
          if (!title) return;
          await run(() => mCreateChapter({ data: { courseId: course.id, title } }));
          setNewChapter("");
          await refresh();
        }}
      >
        <Input
          aria-label={t("teach.chapter.add")}
          placeholder={t("teach.chapter.title")}
          value={newChapter}
          onChange={(e) => setNewChapter(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          <Plus aria-hidden="true" />
          {t("teach.chapter.add")}
        </Button>
      </form>
      <ConfirmDialog
        open={deleting !== null}
        title={t("teach.chapter.delete")}
        description={t("teach.chapter.delete.confirm")}
        confirmLabel={t("common.delete")}
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await run(() => mDeleteChapter({ data: { chapterId: deleting } }));
          setDeleting(null);
          await refresh();
        }}
      />
    </div>
  );
}
