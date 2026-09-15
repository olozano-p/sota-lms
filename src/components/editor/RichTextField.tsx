import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { useI18n } from "~/i18n";
import { parseVideoUrl } from "~/lib/video-links";
import { cn } from "~/lib/cn";
import { PromptDialog } from "~/components/ui/dialog";
import { VideoEmbed } from "./extensions/video-embed";
import { Toolbar } from "./Toolbar";
import { uploadFile, type UploadAdapter } from "./upload";

interface RichTextFieldProps {
  id?: string;
  /** Markdown in, Markdown out: the editor is a view over the stored text (ADR-010). */
  value: string;
  onChange: (md: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** With an adapter the toolbar offers images and files can be pasted or dropped. */
  upload?: UploadAdapter;
  /** Tailwind min-height for the writing surface. */
  minHeightClass?: string;
  /** Changing this value focuses the end of the text (after the parent inserted content). */
  focusToken?: number;
  autoFocus?: boolean;
  className?: string;
}

type Prompt = { kind: "link" | "video"; defaultValue: string } | null;

/** The Markdown extension keeps blank paragraphs as `&nbsp;`; trailing ones are just cursor room. */
function cleanMarkdown(md: string): string {
  const lines = md.split("\n");
  while (lines.length && /^\s*(?:&nbsp;)?\s*$/.test(lines[lines.length - 1]!)) lines.pop();
  return lines.join("\n").trim();
}

const LINK_PROTOCOLS = /^(https?:|mailto:)/i;

/** Tiptap over Markdown: what you edit is set in the same prose column the reader gets. */
export function RichTextField({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  upload,
  minHeightClass = "min-h-40",
  focusToken,
  autoFocus = false,
  className,
}: RichTextFieldProps) {
  const { t } = useI18n();
  const wrapper = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    autofocus: autoFocus ? "end" : false,
    content: value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener" },
        },
      }),
      Image.configure({ allowBase64: false }),
      VideoEmbed.configure({ removeLabel: t("editor.videoRemove") }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Markdown.configure({ indentation: { style: "space", size: 2 } }),
    ],
    editorProps: {
      attributes: {
        class: cn("prose max-w-none px-4 py-3 outline-none", minHeightClass),
        ...(id ? { id } : {}),
      },
      handlePaste: (_view, event) => acceptFiles(event.clipboardData?.files),
      handleDrop: (_view, event) => acceptFiles(event.dataTransfer?.files),
    },
    onUpdate: ({ editor: e }) => onChange(cleanMarkdown(e.getMarkdown())),
    onBlur: ({ event }) => {
      // Moving to the toolbar or a dialog is still editing; only leaving the field saves.
      const next = event.relatedTarget as Node | null;
      if (next && wrapper.current?.contains(next)) return;
      onBlur?.();
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Parent-driven resets (a different record under the same component) reload the document.
  const lastValue = useRef(value);
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    if (value !== cleanMarkdown(editor.getMarkdown())) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    }
    lastValue.current = value;
  }, [editor, value]);
  useEffect(() => {
    lastValue.current = value;
  }, [value]);
  useEffect(() => {
    if (focusToken) editor?.commands.focus("end", { scrollIntoView: true });
  }, [editor, focusToken]);

  function acceptFiles(files: FileList | undefined): boolean {
    if (!upload || !files?.length) return false;
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    for (const f of images) void insertImage(f);
    return true;
  }

  async function insertImage(f: File) {
    const e = editorRef.current;
    if (!upload || !e) return;
    setError(null);
    if (!upload.accept.includes(f.type)) {
      setError(t("editor.imageType"));
      return;
    }
    if (f.size > upload.maxBytes) {
      setError(t("editor.imageTooLarge", { mb: Math.round(upload.maxBytes / 1_048_576) }));
      return;
    }
    setUploading(0);
    try {
      const file = await uploadFile(upload, f, setUploading);
      if (!file.id) throw new Error("upload did not return a file id");
      e.chain()
        .focus()
        .setImage({ src: `/api/files/${file.id}?inline=1`, alt: f.name.replace(/\.[^.]+$/, "") })
        .run();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  const openLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    setPrompt({ kind: "link", defaultValue: "" });
  };

  const applyPrompt = (raw: string): string | undefined => {
    if (!editor || !prompt) return;
    const input = raw.trim();
    if (prompt.kind === "link") {
      const href = LINK_PROTOCOLS.test(input) || input.startsWith("/") ? input : `https://${input}`;
      try {
        if (!href.startsWith("/")) new URL(href);
      } catch {
        return t("editor.linkInvalid");
      }
      const chain = editor.chain().focus().extendMarkRange("link");
      if (editor.state.selection.empty) {
        chain.insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        });
      } else {
        chain.setLink({ href });
      }
      chain.run();
    } else {
      if (!parseVideoUrl(input)) return t("editor.videoInvalid");
      editor.chain().focus().setVideoEmbed(input).run();
    }
    setPrompt(null);
    return;
  };

  return (
    <div ref={wrapper} className={cn("flex flex-col gap-1.5", className)}>
      <div
        className={cn(
          "rounded border border-input bg-card",
          "transition-[border-color] duration-[120ms] ease-(--ease)",
          "has-[.ProseMirror-focused]:border-ring has-[.ProseMirror-focused]:outline-2 has-[.ProseMirror-focused]:outline-offset-0 has-[.ProseMirror-focused]:outline-ring",
        )}
      >
        <Toolbar
          editor={editor}
          onLink={openLink}
          onImage={upload ? () => fileInput.current?.click() : undefined}
          onVideo={() => setPrompt({ kind: "video", defaultValue: "" })}
          uploading={uploading !== null}
        />
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className={cn("prose max-w-none px-4 py-3", minHeightClass)} aria-busy="true" />
        )}
      </div>
      {uploading !== null ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("editor.imageUploading", { pct: uploading })}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          {error}
        </p>
      ) : null}
      {upload ? (
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={upload.accept.join(",")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImage(f);
            e.target.value = "";
          }}
        />
      ) : null}
      <PromptDialog
        open={prompt !== null}
        title={prompt?.kind === "video" ? t("editor.videoTitle") : t("editor.linkTitle")}
        label={prompt?.kind === "video" ? t("editor.videoLabel") : t("editor.linkLabel")}
        description={prompt?.kind === "video" ? t("editor.videoDescription") : undefined}
        placeholder="https://"
        defaultValue={prompt?.defaultValue ?? ""}
        confirmLabel={t("editor.insert")}
        onConfirm={applyPrompt}
        onClose={() => setPrompt(null)}
      />
    </div>
  );
}
