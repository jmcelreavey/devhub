export interface TreeItem {
  type: string;
  name: string;
  path: string;
  children?: TreeItem[];
}

export interface FlatFile {
  path: string;
  name: string;
}

function isTreeItem(value: unknown): value is TreeItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TreeItem>;
  return typeof item.type === "string" && typeof item.name === "string" && typeof item.path === "string";
}

export function flattenTreeFiles(items: unknown[]): FlatFile[] {
  const files: FlatFile[] = [];
  for (const item of items) {
    if (!isTreeItem(item)) continue;
    if (item.type === "file") {
      files.push({ path: item.path, name: item.name.replace(/\.json$/, "") });
    }
    if (item.children) {
      files.push(...flattenTreeFiles(item.children));
    }
  }
  return files;
}
