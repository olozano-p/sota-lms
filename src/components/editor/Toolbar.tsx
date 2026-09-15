import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Redo2,
  TextQuote,
  Undo2,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "~/i18n";
import { Button } from "~/components/ui/button";

interface ToolbarProps {
  editor: Editor | null;
  onLink: () => void;
  onImage?: () => void;
  onVideo: () => void;
  uploading: boolean;
}

/** Ghost icon buttons over a hairline; `aria-pressed` mirrors the marks at the cursor. */
export function Toolbar({ editor, onLink, onImage, onVideo, uploading }: ToolbarProps) {
  const { t } = useI18n();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      code: e?.isActive("code") ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      quote: e?.isActive("blockquote") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
      undo: e?.can().undo() ?? false,
      redo: e?.can().redo() ?? false,
    }),
  });
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);
  const disabled = !editor;

  return (
    <div
      role="toolbar"
      aria-label={t("editor.toolbar")}
      className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
    >
      <Group>
        <Tool
          label={t("editor.heading2")}
          pressed={state?.h2}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}
        >
          <Heading2 />
        </Tool>
        <Tool
          label={t("editor.heading3")}
          pressed={state?.h3}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleHeading({ level: 3 }).run())}
        >
          <Heading3 />
        </Tool>
      </Group>
      <Group>
        <Tool
          label={t("editor.bold")}
          pressed={state?.bold}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleBold().run())}
        >
          <Bold />
        </Tool>
        <Tool
          label={t("editor.italic")}
          pressed={state?.italic}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleItalic().run())}
        >
          <Italic />
        </Tool>
        <Tool
          label={t("editor.code")}
          pressed={state?.code}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleCode().run())}
        >
          <Code />
        </Tool>
      </Group>
      <Group>
        <Tool
          label={t("editor.quote")}
          pressed={state?.quote}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleBlockquote().run())}
        >
          <TextQuote />
        </Tool>
        <Tool
          label={t("editor.bulletList")}
          pressed={state?.bullet}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleBulletList().run())}
        >
          <List />
        </Tool>
        <Tool
          label={t("editor.orderedList")}
          pressed={state?.ordered}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleOrderedList().run())}
        >
          <ListOrdered />
        </Tool>
      </Group>
      <Group>
        <Tool label={t("editor.link")} pressed={state?.link} disabled={disabled} onClick={onLink}>
          <LinkIcon />
        </Tool>
        {onImage ? (
          <Tool label={t("editor.image")} disabled={disabled || uploading} onClick={onImage}>
            <ImageIcon />
          </Tool>
        ) : null}
        <Tool label={t("editor.video")} disabled={disabled} onClick={onVideo}>
          <Video />
        </Tool>
      </Group>
      <Group last>
        <Tool
          label={t("editor.undo")}
          disabled={disabled || !state?.undo}
          onClick={run((e) => e.chain().focus().undo().run())}
        >
          <Undo2 />
        </Tool>
        <Tool
          label={t("editor.redo")}
          disabled={disabled || !state?.redo}
          onClick={run((e) => e.chain().focus().redo().run())}
        >
          <Redo2 />
        </Tool>
      </Group>
    </div>
  );
}

function Group({ children, last = false }: { children: ReactNode; last?: boolean }) {
  return (
    <div
      className={[
        "flex items-center gap-0.5",
        last ? "" : "after:mx-1 after:h-5 after:w-px after:bg-border after:content-['']",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function Tool({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      className={pressed ? "bg-accent" : undefined}
      // Keep the selection in the editor: the click must not move focus to the button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
