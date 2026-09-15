import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { lmsConfig } from "~/config";
import { confirmForumUpload, requestForumUpload } from "~/server/mutations/forum";
import type { UploadAdapter } from "~/components/editor/upload";

/** Images in forum posts: the forum's own presigned-PUT pair, images only. */
export function useForumUpload(courseSlug: string | null): UploadAdapter {
  const request = useServerFn(requestForumUpload);
  const confirm = useServerFn(confirmForumUpload);
  return useMemo(
    () => ({
      accept: lmsConfig.uploads.allowedMime.filter((m) => m.startsWith("image/")),
      maxBytes: lmsConfig.forum.imageMaxBytes,
      request: (f) => request({ data: { courseSlug, ...f } }),
      confirm: (key, filename) => confirm({ data: { key, filename } }),
    }),
    [courseSlug, request, confirm],
  );
}
