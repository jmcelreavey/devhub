import fs from "node:fs";
import path from "node:path";
import {
  detectJsonFileType,
  extractPlainTextFromBlockNote,
  extractPlainTextFromTldraw,
} from "./extract.ts";

export interface SearchResult {
  path: string;
  line: number;
  text: string;
}

export interface SearchNotesOptions {
  /** Filter by vault-relative path. MCP uses `isWorkspaceNoteRel`; dashboard defaults to all json. */
  includePath?: (relPath: string) => boolean;
  /** Default true (dashboard). MCP sets false. */
  includeTldraw?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export function searchNotes(
  root: string,
  query: string,
  options: SearchNotesOptions = {},
): SearchResult[] {
  const {
    includePath = () => true,
    includeTldraw = true,
    limit = DEFAULT_LIMIT,
  } = options;

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
