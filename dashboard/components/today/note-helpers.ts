import type { DevHubPartialBlock } from "@/lib/blocknote-schema";

/** Single empty paragraph — daily notes start blank until you write something. */
export const EMPTY_NOTE_BLOCKS: DevHubPartialBlock[] = [
  {
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text: "", styles: {} }],
    children: [],
  },
];

export function blocksPlainText(blocks: DevHubPartialBlock[]): string {
  const parts: string[] = [];
  function walk(block: DevHubPartialBlock) {
    const inlines = block.content;
    if (Array.isArray(inlines)) {
      for (const item of inlines) {
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          (item as { type: string }).type === "text" &&
          "text" in item
        ) {
          parts.push(String((item as { text: unknown }).text ?? ""));
        }
      }
    }
    const kids = block.children;
    if (Array.isArray(kids)) {
      for (const kid of kids) walk(kid as DevHubPartialBlock);
    }
  }
  for (const b of blocks) walk(b);
  return parts.join("");
}

/** No persisted file for whitespace-only notes. */
export function isNoteEffectivelyEmpty(blocks: DevHubPartialBlock[]): boolean {
  function hasNonParagraphBlock(b: DevHubPartialBlock): boolean {
    if (b.type !== "paragraph") return true;
    const kids = b.children;
    if (Array.isArray(kids)) {
      return (kids as DevHubPartialBlock[]).some(hasNonParagraphBlock);
    }
    return false;
  }
  if (blocks.some(hasNonParagraphBlock)) return false;
  return blocksPlainText(blocks).trim().length === 0;
}
