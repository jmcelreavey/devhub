import { createExtension } from "@blocknote/core";
import { Plugin, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { parseTagLine } from "@/lib/notes/tag-line";

/** Text blocks a tags line can live in; headings and code keep their text as written. */
const TAG_LINE_BLOCKS = new Set(["paragraph", "bulletListItem"]);

type Doc = EditorState["doc"];

function tagLineDecorations(doc: Doc): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!TAG_LINE_BLOCKS.has(node.type.name)) return false;
    // Cheap bail-out before parsing: every note block is visited on every doc change.
    const text = node.textContent;
    if (text.length < 6 || !/^\s*tags:/i.test(text)) return false;
    // Offsets are text offsets; only trust them when the block is plain text nodes.
    let plain = true;
    node.forEach((child) => {
      if (!child.isText) plain = false;
    });
    const line = plain ? parseTagLine(text) : null;
    if (!line) return false;
    const base = pos + 1;
    decorations.push(Decoration.inline(base + line.label.start, base + line.label.end, { class: "note-tag-label" }));
    for (const token of line.tags) {
      decorations.push(Decoration.inline(base + token.start, base + token.end, { class: "note-tag-chip" }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

// Selection moves also re-run `decorations`; the document is immutable, so key the result on it.
const cache = new WeakMap<Doc, DecorationSet>();

/** Dresses `Tags: #a #b` lines as pills in the editor. Display only: the document is never changed. */
export const tagLineExtension = createExtension({
  key: "devhubTagLines",
  prosemirrorPlugins: [
    new Plugin({
      props: {
        decorations(state) {
          let set = cache.get(state.doc);
          if (!set) {
            set = tagLineDecorations(state.doc);
            cache.set(state.doc, set);
          }
          return set;
        },
      },
    }),
  ],
});
