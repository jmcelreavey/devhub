export interface CheckboxBlock {
  id: string;
  text: string;
  checked: boolean;
}

function inlineToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const inline = item as { text?: string; content?: unknown };
      if (typeof inline.text === "string") return inline.text;
      return inlineToText(inline.content);
    })
    .join("");
}

/**
 * Collect `checkListItem` blocks (recursively, including nested children) so they
 * can be pushed into the tasks system. Blocks without text are skipped.
 */
export function collectCheckboxBlocks(blocks: unknown[]): CheckboxBlock[] {
  const out: CheckboxBlock[] = [];
  for (const block of blocks) {
    const b = block as { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: unknown[] };
    if (b.type === "checkListItem" && typeof b.id === "string") {
      const text = inlineToText(b.content).trim();
      if (text) out.push({ id: b.id, text, checked: !!b.props?.checked });
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      out.push(...collectCheckboxBlocks(b.children));
    }
  }
  return out;
}
