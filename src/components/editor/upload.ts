/** The two-step upload every editor surface uses: ask for a presigned PUT, PUT, confirm. */
export interface UploadedFile {
  id?: string;
  key: string;
  filename: string;
  mime: string;
  size: number;
}

export interface UploadAdapter {
  /** Mime types the picker offers and the server accepts. */
  accept: string[];
  maxBytes: number;
  /** Asks the server for a presigned PUT. */
  request: (f: {
    filename: string;
    mime: string;
    size: number;
  }) => Promise<{ url: string; key: string }>;
  /** Tells the server the PUT is done; it HEADs the object and records the file. */
  confirm: (key: string, filename: string) => Promise<UploadedFile>;
}

/** Browser → object storage, straight from the presigned URL, with progress in percent. */
export function putWithProgress(
  url: string,
  file: File,
  mime: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", mime);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(file);
  });
}

/** Runs the whole flow; throws with a readable message on any step. */
export async function uploadFile(
  adapter: UploadAdapter,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadedFile> {
  const mime = file.type || "application/octet-stream";
  const { url, key } = await adapter.request({ filename: file.name, mime, size: file.size });
  await putWithProgress(url, file, mime, onProgress);
  return adapter.confirm(key, file.name);
}
