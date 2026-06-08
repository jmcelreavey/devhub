import type { TreeEntry } from "@/lib/vault/vault-storage";

export interface VaultIndexFile {
  slug: string;
  label: string;
  href: string;
  folderPath: string;
  modified?: number;
}

export interface VaultIndexFolder {
  path: string;
  name: string;
  files: VaultIndexFile[];
  children: VaultIndexFolder[];
}

export interface VaultIndexSummary {
  totalFiles: number;
  rootFiles: VaultIndexFile[];
  folders: VaultIndexFolder[];
  recent: VaultIndexFile[];
}

export interface BuildVaultIndexSummaryOptions {
  extension: string;
  pageHref: (slug: string) => string;
  maxRecent?: number;
}

export function stripVaultExtension(name: string, extension: string): string {
  const extRe = new RegExp(`${extension.replace(".", "\\.")}$`, "i");
  return name.replace(extRe, "");
}

function entryToFile(
  entry: TreeEntry,
  folderPath: string,
  options: BuildVaultIndexSummaryOptions,
): VaultIndexFile {
  const slug = entry.path.replace(/\\/g, "/").replace(
    new RegExp(`${options.extension.replace(".", "\\.")}$`, "i"),
    "",
  );
  const label = stripVaultExtension(entry.name, options.extension);
  return {
    slug,
    label,
    href: options.pageHref(slug),
    folderPath,
    modified: entry.modified,
  };
}

function buildFolder(
  entry: TreeEntry,
  options: BuildVaultIndexSummaryOptions,
): VaultIndexFolder {
  const folderPath = entry.path.replace(/\\/g, "/");
  const files: VaultIndexFile[] = [];
  const children: VaultIndexFolder[] = [];

  for (const child of entry.children ?? []) {
    if (child.type === "file") {
      files.push(entryToFile(child, folderPath, options));
    } else {
      children.push(buildFolder(child, options));
    }
  }

  return {
    path: folderPath,
    name: entry.name,
    files,
    children,
  };
}

function collectAllFiles(
  summary: Pick<VaultIndexSummary, "rootFiles" | "folders">,
): VaultIndexFile[] {
  const out: VaultIndexFile[] = [...summary.rootFiles];

  function walk(folder: VaultIndexFolder) {
    out.push(...folder.files);
    for (const child of folder.children) {
      walk(child);
    }
  }

  for (const folder of summary.folders) {
    walk(folder);
  }

  return out;
}

export function buildVaultIndexSummary(
  tree: TreeEntry[],
  options: BuildVaultIndexSummaryOptions,
): VaultIndexSummary {
  const rootFiles: VaultIndexFile[] = [];
  const folders: VaultIndexFolder[] = [];

  for (const entry of tree) {
    if (entry.type === "file") {
      rootFiles.push(entryToFile(entry, "", options));
    } else {
      folders.push(buildFolder(entry, options));
    }
  }

  const maxRecent = options.maxRecent ?? 8;
  const recent = collectAllFiles({ rootFiles, folders })
    .filter((f) => f.modified != null)
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
    .slice(0, maxRecent);

  return {
    totalFiles: collectAllFiles({ rootFiles, folders }).length,
    rootFiles,
    folders,
    recent,
  };
}
