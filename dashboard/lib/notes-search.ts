import fs from "node:fs";
import path from "node:path";

export interface SearchResult {
  path: string;
  line: number;
  text: string;
}

export interface SearchNotesOptions {
  includePath?: (relPath: string) => boolean;
  includeTldraw?: boolean;
  limit?: number;
}

type JsonFileType = "blocknote" | "tldraw" | "unknown";

const DEFAULT_LIMIT = 50;

function detectJsonFileType(parsed: unknown): JsonFileType {
  if (Array.isArray(parsed)) return "blocknote";
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "tldraw") return "tldraw";
  return "unknown";
}

function extractPlainTextFromBlockNote(blocks: unknown[]): string {
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

function extractPlainTextFromTldraw(data: unknown): string {
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

export function searchNotes(
  root: string,
  query: string,
  options: SearchNotesOptions = {},
): SearchResult[] {
  const { includePath = () => true, includeTldraw = true, limit = DEFAULT_LIMIT } = options;

  const results: SearchResult[] = [];
  const q = query.toLowerCase();
  const resolvedRoot = path.resolve(root);

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".json")) {
        const relPath = path.relative(resolvedRoot, fullPath);
        if (!includePath(relPath)) continue;
        try {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const parsed = JSON.parse(raw);
          const fileType = detectJsonFileType(parsed);
          let text: string | null = null;
          if (fileType === "tldraw" && includeTldraw) {
            text = extractPlainTextFromTldraw(parsed);
          } else if (fileType === "blocknote") {
            text = extractPlainTextFromBlockNote(Array.isArray(parsed) ? parsed : [parsed]);
          } else {
            continue;
          }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({ path: relPath, line: i + 1, text: lines[i].trim() });
              if (results.length >= limit) return;
            }
          }
        } catch (err) {
          console.error(`searchNotes: malformed JSON in ${fullPath}:`, err);
        }
      }
    }
  };

  walk(resolvedRoot);
  return results.slice(0, limit);
}
