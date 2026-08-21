import path from "node:path";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { isSafeRepoRelPath } from "@/lib/git/ref-safety";
import { parseFileHistory, type FileHistoryCommit } from "@/lib/repos/git-parsers";
import { getVault, type VaultId } from "@/lib/vault/vault-registry";

export type { FileHistoryCommit };

export interface VaultGitTarget {
  checkoutRoot: string;
  /** Path relative to the checkout, POSIX separators (what git wants). */
  repoRelPath: string;
}

/**
 * Map a vault slug to a git-tracked path inside the DevHub checkout.
 *
 * Returns null when there is no checkout (installed app), the vault root sits
 * outside that checkout (custom NOTES_DIR), or the slug looks unsafe.
 */
export function resolveVaultGitPath(vaultId: VaultId, slug: string): VaultGitTarget | null {
  const checkout = getCheckoutRoot();
  if (!checkout) return null;

  const vault = getVault(vaultId);
  const normalized = vault.paths.normalizeSlug(slug).replace(/\\/g, "/");
  if (!normalized || normalized.split("/").includes("..")) return null;

  const diskName = normalized.endsWith(vault.extension)
    ? normalized
    : `${normalized}${vault.extension}`;
  if (!isSafeRepoRelPath(diskName)) return null;

  const absFile = path.resolve(vault.getRoot(), diskName);
  const rel = path.relative(checkout, absFile);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;

  const repoRelPath = rel.split(path.sep).join("/");
  if (!isSafeRepoRelPath(repoRelPath)) return null;

  return { checkoutRoot: checkout, repoRelPath };
}

export async function listVaultFileHistory(
  vaultId: VaultId,
  slug: string,
  limit = 30,
): Promise<{ available: false } | { available: true; path: string; commits: FileHistoryCommit[] }> {
  const target = resolveVaultGitPath(vaultId, slug);
  if (!target) return { available: false };

  const max = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 30;
  const result = await runGitRepoAsync(
    target.checkoutRoot,
    [
      "log",
      "--follow",
      `--max-count=${max}`,
      "--format=%x1e%H%x00%h%x00%s%x00%an%x00%ar",
      "--",
      target.repoRelPath,
    ],
    { timeout: 15_000 },
  );

  // Untracked / never committed → empty history, still "available".
  if (result.status !== 0) {
    return { available: true, path: target.repoRelPath, commits: [] };
  }

  return {
    available: true,
    path: target.repoRelPath,
    commits: parseFileHistory(result.stdout || ""),
  };
}
