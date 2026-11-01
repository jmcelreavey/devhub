export type JsonFileType = "blocknote" | "tldraw" | "unknown";

export function detectJsonFileType(parsed: unknown): JsonFileType {
  if (Array.isArray(parsed)) return "blocknote";
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "tldraw") return "tldraw";
  return "unknown";
}

/** Plain inline text for search — not markdown export (see notes-server convert.ts). */
export function extractPlainTextFromBlockNote(blocks: unknown[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    if (Array.isArray(b.content)) {
      const textParts: string[] = [];
      for (const inline of b.content as Record<string, unknown>[]) {
        if (typeof inline.text === "string") {
          textParts.push(inline.text);
        }
      }
      lines.push(textParts.join(""));
    } else if (b.type === "sharedChecklist" || b.type === "collection") {
      const props = b.props as Record<string, unknown> | undefined;
      const masterListId =
        typeof props?.masterListId === "string"
          ? props.masterListId.trim()
          : typeof props?.collectionId === "string"
            ? props.collectionId.trim()
            : "";
      if (masterListId) {
        lines.push(`shared checklist ${masterListId}`);
      }
    }
    if (Array.isArray(b.children) && (b.children as unknown[]).length > 0) {
      lines.push(...extractPlainTextFromBlockNote(b.children as unknown[]).split("\n"));
    }
  }
  return lines.join("\n");
}

/** Walk a tldraw `richText` (TipTap) doc and collect its text nodes. */
function collectRichText(node: unknown, acc: string[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === "string" && n.text.trim()) acc.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) collectRichText(child, acc);
  }
}

export function extractPlainTextFromTldraw(data: unknown): string {
  // Diagrams persist a tldraw `TLStoreSnapshot` (`{ store: records, schema }`)
  // under `store`. Drill into the inner records map, tolerating a flat map too.
  const outer = (data as { store?: Record<string, unknown> })?.store ?? {};
  const records = (outer as { store?: Record<string, unknown> }).store ?? outer;
  const texts: string[] = [];

  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith("shape:") || !value || typeof value !== "object") continue;
    const shape = value as Record<string, unknown>;
    const props = shape.props as Record<string, unknown> | undefined;
    // tldraw v5 labels live in `richText`; older/plain shapes use `text`/`name`.
    collectRichText(props?.richText, texts);
    if (typeof props?.text === "string" && props.text.trim()) {
      texts.push(props.text);
    }
    if (typeof props?.name === "string" && props.name.trim()) {
      texts.push(props.name);
    }
  }

  return texts.join("\n");
}
