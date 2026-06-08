import path from "node:path";

/** Day pages + scratch JSON at notes root. MCP `notes_search` scope; dashboard searches the full vault. */
export function isWorkspaceNoteRel(relPath: string): boolean {
  const n = relPath.split(path.sep).join("/");
  return !n.includes("/") || n.startsWith("daily/");
}
