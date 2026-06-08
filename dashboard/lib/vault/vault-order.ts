import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import type { TreeEntry } from "@/lib/vault/vault-storage";

interface VaultOrderFile {
  version: 1;
  folders: Record<string, string[]>;
}

const ORDER_FILE = ".devhub-order.json";

function orderFilePath(rootDir: string): string {
  return path.join(rootDir, ORDER_FILE);
}

function defaultOrder(): VaultOrderFile {
  return { version: 1, folders: {} };
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function parentPath(input: string): string {
  const normalized = normalizePath(input);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function defaultCompare(a: TreeEntry, b: TreeEntry): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function readOrder(rootDir: string): VaultOrderFile {
  const parsed = safeReadJSON<VaultOrderFile>(orderFilePath(rootDir), defaultOrder());
  return parsed && parsed.version === 1 && typeof parsed.folders === "object" ? parsed : defaultOrder();
}

async function writeOrder(rootDir: string, order: VaultOrderFile): Promise<void> {
  await writeAtomic(orderFilePath(rootDir), JSON.stringify(order, null, 2) + "\n");
}

export function applyVaultOrder(
  entries: TreeEntry[],
  rootDir: string,
  folder = "",
  order = readOrder(rootDir),
): TreeEntry[] {
  const orderedPaths = order.folders[folder] ?? [];
  const rank = new Map(orderedPaths.map((entryPath, index) => [normalizePath(entryPath), index]));
  return [...entries]
    .sort((a, b) => {
      const aRank = rank.get(normalizePath(a.path));
      const bRank = rank.get(normalizePath(b.path));
      if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
      if (aRank !== undefined) return -1;
      if (bRank !== undefined) return 1;
      return defaultCompare(a, b);
    })
    .map((entry) =>
      entry.type === "dir" && entry.children
        ? { ...entry, children: applyVaultOrder(entry.children, rootDir, normalizePath(entry.path), order) }
        : entry,
    );
}

export async function reorderOrderedVaultEntries(
  entries: TreeEntry[],
  rootDir: string,
  orderedPaths: string[],
): Promise<boolean> {
  return withMutex(`vault-order:${rootDir}`, async () => {
    if (orderedPaths.length === 0) return false;

    const normalizedPaths = orderedPaths.map(normalizePath);
    const folder = parentPath(normalizedPaths[0]!);
    if (normalizedPaths.some((entryPath) => parentPath(entryPath) !== folder)) return false;

    const orderedTree = applyVaultOrder(entries, rootDir);
    const siblings = findSiblings(orderedTree, folder);
    const siblingPaths = siblings.map((entry) => normalizePath(entry.path));
    const requested = new Set(normalizedPaths);
    const siblingSet = new Set(siblingPaths);
    if (
      requested.size !== normalizedPaths.length ||
      normalizedPaths.some((entryPath) => !siblingSet.has(entryPath))
    ) {
      return false;
    }

    let nextIndex = 0;
    const nextPaths = siblingPaths.map((entryPath) =>
      requested.has(entryPath) ? normalizedPaths[nextIndex++]! : entryPath,
    );
    const order = readOrder(rootDir);
    order.folders[folder] = nextPaths;
    await writeOrder(rootDir, order);
    return true;
  });
}

function findSiblings(entries: TreeEntry[], folder: string): TreeEntry[] {
  if (!folder) return entries;
  const segments = folder.split("/");
  let current = entries;
  for (const segment of segments) {
    const dir = current.find((entry) => entry.type === "dir" && entry.name === segment);
    if (!dir?.children) return [];
    current = dir.children;
  }
  return current;
}
