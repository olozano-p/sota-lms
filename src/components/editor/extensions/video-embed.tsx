import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { X } from "lucide-react";
import { parseVideoUrl } from "~/lib/video-links";
import { Button } from "~/components/ui/button";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    videoEmbed: {
      /** Inserts a player for a YouTube or Vimeo page URL; false when the URL is not recognised. */
      setVideoEmbed: (url: string) => ReturnType;
    };
  }
}

/**
 * A YouTube/Vimeo player as a block. Stored in Markdown as the page URL alone on its line, which
 * is exactly what `renderMarkdown()` turns into an iframe, so the editor and the reader agree. A
 * paragraph that is only such a URL (typed, pasted or loaded from Markdown) becomes this node.
 */
export const VideoEmbed = Node.create<{ removeLabel: string }>({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return { removeLabel: "Remove" };
  },

  addAttributes() {
    return { src: { default: "" } };
  },

  parseHTML() {
    return [
      { tag: "figure[data-video]", getAttrs: (el) => ({ src: el.getAttribute("data-video") }) },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const video = parseVideoUrl(String(node.attrs.src ?? ""));
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-video": node.attrs.src, class: "embed" }),
      ...(video ? [["iframe", { src: video.embedSrc, title: "", loading: "lazy" }] as const] : []),
    ];
  },

  renderMarkdown(node: JSONContent) {
    return String(node.attrs?.src ?? "");
  },

  addCommands() {
    return {
      setVideoEmbed:
        (url) =>
        ({ commands }) => {
          const video = parseVideoUrl(url);
          if (!video) return false;
          return commands.insertContent({ type: this.name, attrs: { src: video.url } });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoEmbedView);
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = state.tr;
          convertVideoParagraphs(state.doc, tr, type.name);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },

  onCreate() {
    const { state, view } = this.editor;
    const tr = state.tr;
    convertVideoParagraphs(state.doc, tr, this.name);
    if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
  },
});

/** Replaces every paragraph whose whole text is a recognised video URL with a `videoEmbed`. */
function convertVideoParagraphs(doc: PMNode, tr: Transaction, nodeName: string) {
  const targets: { pos: number; size: number; url: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    const text = node.textContent.trim();
    if (!text || /\s/.test(text)) return false;
    const video = parseVideoUrl(text);
    if (video) targets.push({ pos, size: node.nodeSize, url: video.url });
    return false;
  });
  const type = tr.doc.type.schema.nodes[nodeName]!;
  for (const t of targets.reverse()) {
    tr.replaceWith(
      tr.mapping.map(t.pos),
      tr.mapping.map(t.pos + t.size),
      type.create({ src: t.url }),
    );
  }
}

function VideoEmbedView({ node, deleteNode, selected, extension }: ReactNodeViewProps) {
  const video = parseVideoUrl(String(node.attrs.src ?? ""));
  return (
    <NodeViewWrapper
      as="figure"
      className={["embed relative", selected ? "outline-2 outline-offset-2 outline-ring" : ""].join(
        " ",
      )}
      data-video={node.attrs.src}
    >
      {video ? (
        <iframe
          src={video.embedSrc}
          title=""
          loading="lazy"
          className="pointer-events-none aspect-video w-full rounded-lg border bg-card"
        />
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {String(node.attrs.src)}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={(extension.options as { removeLabel: string }).removeLabel}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
      >
        <X aria-hidden="true" />
      </Button>
    </NodeViewWrapper>
  );
}
