/**
 * Repairs list blocks written by older note scaffolds, at load time (nothing is
 * written until the note is next saved, because BlockNote does not fire onChange
 * for its initial content):
 *
 * - a bullet whose text is only "[ ]" or "[]" (an empty "- [ ]" line that was
 *   parsed as a bullet) becomes an empty bullet — John rarely uses checkboxes;
 * - a bullet whose text is only "[x]" becomes an empty checked checkbox, so the
 *   tick is not lost;
 * - a bullet starting "[ ] text" / "[x] text" becomes a real checkbox; spans
 *   after the marker (bold, links, …) are kept as they were;
 * - a paragraph that is only "-" (an empty "- " line) becomes an empty bullet.
 *
 * Idempotent, one pass, and returns the very same array (and block objects)
 * when nothing needed repair, so callers can compare by identity.
 */
interface Inline {
  type?: string;
  text?: string;
  styles?: Record<string, unknown>;
}
export interface RepairableBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: RepairableBlock[];
  [key: string]: unknown;
}

const EMPTY_MARKER = /^\[([ xX]?)\]$/;
const MARKER_PREFIX = /^\[([ xX])\]\s+/;

function isText(node: unknown): node is Inline {
  return !!node && typeof node === "object" && (node as Inline).type === "text";
}

/** Text of the whole content when it is all plain text spans, else null. */
function allText(content: unknown): string | null {
  if (!Array.isArray(content) || !content.every(isText)) return null;
  return (content as Inline[]).map((c) => c.text ?? "").join("");
}

/** Drop the first `length` characters from the leading text spans; later spans are untouched. */
function dropLeading(content: Inline[], length: number): Inline[] {
  const out: Inline[] = [];
  let left = length;
  for (const node of content) {
    if (left > 0 && isText(node)) {
      const text = node.text ?? "";
      const cut = Math.min(left, text.length);
      left -= cut;
      if (cut < text.length) out.push({ ...node, text: text.slice(cut) });
    } else {
      out.push(node);
    }
  }
  return out;
}

/** The leading run of text spans, joined (so "[ ] " split across spans still matches). */
function leadingText(content: Inline[]): string {
  let text = "";
  for (const node of content) {
    if (!isText(node)) break;
    text += node.text ?? "";
  }
  return text;
}

function repairOne(block: RepairableBlock): RepairableBlock {
  const children = Array.isArray(block.children) ? repairNoteBlocks(block.children) : block.children;
  let next: RepairableBlock = children === block.children ? block : { ...block, children };

  if (block.type === "bulletListItem" && Array.isArray(block.content)) {
    const content = block.content as Inline[];
    const whole = allText(content);
    const marker = whole === null ? null : EMPTY_MARKER.exec(whole.trim());
    if (marker) {
      next =
        marker[1].toLowerCase() === "x"
          ? { ...next, type: "checkListItem", props: { ...(block.props ?? {}), checked: true }, content: [] }
          : { ...next, content: [] };
    } else {
      const prefix = MARKER_PREFIX.exec(leadingText(content));
      if (prefix) {
        const rest = dropLeading(content, prefix[0].length);
        if (rest.length > 0) {
          next = {
            ...next,
            type: "checkListItem",
            props: { ...(block.props ?? {}), checked: prefix[1].toLowerCase() === "x" },
            content: rest,
          };
        }
      }
    }
  } else if (block.type === "paragraph" && allText(block.content)?.trim() === "-") {
    next = { ...next, type: "bulletListItem", content: [] };
  }
  return next;
}

export function repairNoteBlocks<T extends object>(blocks: T[]): T[] {
  let out: T[] | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const repaired = repairOne(blocks[i] as RepairableBlock) as unknown as T;
    if (repaired !== blocks[i]) {
      out ??= blocks.slice();
      out[i] = repaired;
    }
  }
  return out ?? blocks;
}
