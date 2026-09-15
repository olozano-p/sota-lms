import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { Plugin, Selection, type Transaction } from "@tiptap/pm/state";
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
      ...(video
        ? [["iframe", { src: video.embedSrc, title: video.provider, loading: "lazy" }] as const]
        : []),
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
          // While typing, the line converts once the cursor has left it (Enter); a paste
          // converts at once and the cursor lands after the player.
          const pasted = transactions.some(
            (tr) => tr.getMeta("paste") || tr.getMeta("uiEvent") === "paste",
          );
          const tr = state.tr;
          convertVideoParagraphs(state.doc, tr, type.name, pasted ? null : state.selection.head);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },

  onCreate() {
    const { state, view } = this.editor;
    const tr = state.tr;
    convertVideoParagraphs(state.doc, tr, this.name, null);
    if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
  },
});

/**
 * Replaces every paragraph whose whole text is a recognised video URL with a `videoEmbed`,
 * except the one the cursor is in (`skipHead`). After a paste the cursor lands after the player.
 */
function convertVideoParagraphs(
  doc: PMNode,
  tr: Transaction,
  nodeName: string,
  skipHead: number | null,
) {
  const targets: { pos: number; size: number; url: string }[] = [];
  doc.descendants((node, pos, parent) => {
    // Only top-level paragraphs: a URL quoted inside a blockquote stays a link, as in the reader.
    if (node.type.name !== "paragraph") return node.type.name === "doc" || parent === null;
    if (parent && parent.type.name !== "doc") return false;
    if (skipHead !== null && skipHead >= pos && skipHead <= pos + node.nodeSize) return false;
    const text = node.textContent.trim();
    if (!text || /\s/.test(text)) return false;
    const video = parseVideoUrl(text);
    if (video) targets.push({ pos, size: node.nodeSize, url: video.url });
    return false;
  });
  const type = tr.doc.type.schema.nodes[nodeName]!;
  let after: number | null = null;
  for (const t of targets.reverse()) {
    const from = tr.mapping.map(t.pos);
    tr.replaceWith(from, tr.mapping.map(t.pos + t.size), type.create({ src: t.url }));
    after = from + 1;
  }
  if (after !== null && skipHead === null) {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size)), 1));
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
          title={video.provider === "youtube" ? "YouTube" : "Vimeo"}
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
