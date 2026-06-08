import type { TreeEntry } from "./vault-storage.ts";

/** Flatten a vault tree into display lines for MCP list tools. */
export function flattenTree(items: TreeEntry[], prefix = ""): string[] {
  const result: string[] = [];
  for (const item of items) {
    const displayPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.type === "dir") {
      result.push(`📁 ${displayPath}/`);
      result.push(...flattenTree(item.children ?? [], displayPath));
    } else {
      result.push(`📄 ${displayPath}`);
    }
  }
  return result;
}
