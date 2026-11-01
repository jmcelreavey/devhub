import fs from "node:fs";
import path from "node:path";

export interface TextSearchResult {
  path: string;
  line: number;
  text: string;
  score: number;
}

function walkExtensionFiles(
  dir: string,
  extension: string,
  root: string,
  out: string[],
): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkExtensionFiles(fullPath, extension, root, out);
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      out.push(path.relative(root, fullPath));
    }
  }
}

/** Index of the first body line, skipping a leading `---` frontmatter block. */
function frontmatterEndLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0;
}

export function searchTextFiles(
  root: string,
  extension: string,
  query: string,
  limit = 50,
): TextSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const files: string[] = [];
  walkExtensionFiles(root, extension, root, files);

  const results: TextSearchResult[] = [];
  const extRe = new RegExp(`${extension.replace(".", "\\.")}$`);

  for (const relPath of files) {
    const fullPath = path.join(root, relPath);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const lines = raw.split("\n");
    // Skip the frontmatter block. Its tags and descriptions restate the body,
    // so matching there returns the same page twice — once for the content and
    // once for the metadata describing that content.
    const start = frontmatterEndLine(lines);
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes(q)) continue;
      const idx = line.toLowerCase().indexOf(q);
      results.push({
        path: relPath.replace(extRe, ""),
        line: i + 1,
        text: line.trim(),
        score: 100 - idx,
      });
      if (results.length >= limit) return results.sort((a, b) => b.score - a.score);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
