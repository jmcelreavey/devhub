import { copyTextToClipboard } from "@/lib/clipboard";
import { parseEntityLinksFromMarkdown } from "@/lib/entity-note";
import {
  DIAGRAMS_DIR,
  isDiagramStoragePath,
  type TldrawDiagramData,
} from "@/lib/diagram-utils";
import { blocksToPortableMarkdown, blocksToText } from "@/lib/markdown-convert";
import { openRepoInCursor } from "@/lib/open-in-cursor-client";
import { getVaultClient, type VaultId } from "@/lib/vault/vault-client";
import type { useToast } from "@/lib/hooks/use-toast";

export type VaultRowKind = "notes" | "docs" | "diagrams";

export function vaultIdForKind(kind: VaultRowKind): VaultId {
  return kind === "docs" ? "docs" : "notes";
}

export function fileKindForRow(kind: VaultRowKind, slug: string, href?: string): VaultRowKind {
  if (kind === "diagrams") return "diagrams";
  if (href?.startsWith("/diagrams") || isDiagramStoragePath(slug)) return "diagrams";
  return kind;
}

/** Folder storage path for a library-nav group id. */
export function vaultFolderPath(kind: VaultRowKind, groupId: string): string {
  if (kind === "diagrams") return groupId ? `${DIAGRAMS_DIR}/${groupId}` : DIAGRAMS_DIR;
  return groupId;
}

/** Keep the parent folder when renaming a path's last segment. */
export function siblingRenamePath(currentPath: string, newBaseName: string): string {
  const parent = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";
  return parent ? `${parent}/${newBaseName}` : newBaseName;
}

function isTldrawContent(content: unknown): content is TldrawDiagramData {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as { type?: unknown }).type === "tldraw"
  );
}

function diagramSnapshotMarkdown(title: string, content: TldrawDiagramData): string {
  return [
    `# ${title}`,
    "",
    "DevHub tldraw diagram snapshot.",
    "",
    "```json",
    JSON.stringify(content, null, 2),
    "```",
    "",
  ].join("\n");
}

export function duplicateSlug(slug: string): string {
  const copy = slug.match(/^(.*-copy)(?:-(\d+))?$/);
  if (!copy) return `${slug}-copy`;
  const next = copy[2] ? Number(copy[2]) + 1 : 2;
  return `${copy[1]}-${next}`;
}

export function vaultFileUrl(vaultId: VaultId, slug: string, query = ""): string {
  const vault = getVaultClient(vaultId);
  const path = vault.paths.apiPathFromSlug(slug);
  return `${vault.apiPrefix}/${path}${query}`;
}

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? res.statusText;
}

interface VaultFilePayload {
  content: unknown;
  modified?: number;
}

export async function fetchVaultFile(vaultId: VaultId, slug: string): Promise<VaultFilePayload> {
  const res = await fetch(vaultFileUrl(vaultId, slug));
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as VaultFilePayload;
}

export async function copyVaultLocation(slug: string): Promise<void> {
  await copyTextToClipboard(slug);
}

export async function copyVaultMarkdown(vaultId: VaultId, slug: string): Promise<void> {
  const { content } = await fetchVaultFile(vaultId, slug);
  if (typeof content === "string") {
    await copyTextToClipboard(content);
    return;
  }
  if (isTldrawContent(content)) {
    const title = slug.split("/").pop() ?? slug;
    await copyTextToClipboard(diagramSnapshotMarkdown(title, content));
    return;
  }
  if (!Array.isArray(content)) {
    throw new Error("This file has no markdown to copy.");
  }
  await copyTextToClipboard(blocksToPortableMarkdown(content));
}

export async function shareVaultGist(vaultId: VaultId, slug: string): Promise<string> {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault: vaultId, path: slug }),
  });
  const body = (await res.json().catch(() => ({}))) as { share?: { url: string }; error?: string };
  if (!res.ok || !body.share) throw new Error(body.error ?? res.statusText);
  await copyTextToClipboard(body.share.url).catch(() => undefined);
  return body.share.url;
}

export async function duplicateVaultFile(vaultId: VaultId, slug: string): Promise<string> {
  const { content } = await fetchVaultFile(vaultId, slug);
  let next = duplicateSlug(slug);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(vaultFileUrl(vaultId, next), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      getVaultClient(vaultId).paths.notifyTreeChanged();
      return next;
    }
    if (res.status !== 409) throw new Error(await readError(res));
    next = duplicateSlug(next);
  }
  throw new Error("Could not find a free copy name.");
}

export async function createVaultFolder(vaultId: VaultId, folderPath: string): Promise<void> {
  const res = await fetch(vaultFileUrl(vaultId, folderPath, "?dir=1"), { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  getVaultClient(vaultId).paths.notifyTreeChanged();
}

export async function renameVaultFolder(
  vaultId: VaultId,
  currentPath: string,
  newPath: string,
): Promise<void> {
  const res = await fetch(vaultFileUrl(vaultId, currentPath), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPath, dir: true }),
  });
  if (!res.ok) throw new Error(await readError(res));
  getVaultClient(vaultId).paths.notifyTreeChanged();
}

export async function openLinkedNoteInCursor(
  slug: string,
  toast: ReturnType<typeof useToast>,
): Promise<void> {
  const { content } = await fetchVaultFile("notes", slug);
  if (!Array.isArray(content)) {
    toast.error("Link a repo on this note first.");
    return;
  }
  const repos = parseEntityLinksFromMarkdown(blocksToText(content))
    .filter((ref) => ref.kind === "repo")
    .map((ref) => ref.id);
  const repo = repos[0];
  if (!repo) {
    toast.error("Link a repo on this note first.");
    return;
  }
  await openRepoInCursor(repo, toast, slug);
}
