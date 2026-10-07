import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/content/dirs";
import { writeAtomic } from "@/lib/atomic-write";
import { listRepos } from "@/lib/repos";
import { loadWorktreeContext, worktreeInventory } from "./worktree-inventory";

export interface WorktreeReport {
  scannedAt: string;
  repositories: { name: string; checkouts: number; candidates: number; bytes: number; href: string }[];
  errors: { name: string; error: string }[];
}
const reportPath = () => path.join(getNotesDir(), ".cache", "worktrees", "latest.json");
export function readWorktreeReport(): WorktreeReport | null {
  try { return JSON.parse(fs.readFileSync(reportPath(), "utf8")) as WorktreeReport; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function scanWorktrees(emit: (line: string) => void): Promise<WorktreeReport> {
  const context = loadWorktreeContext();
  const report: WorktreeReport = { scannedAt: new Date().toISOString(), repositories: [], errors: [] };
  for (const repo of (await listRepos()).filter((repo) => !repo.worktreeOf && (repo.worktreeCount == null || repo.worktreeCount > 0))) {
    try {
      const inventory = await worktreeInventory(repo.path, true, undefined, context);
      const candidates = inventory.worktrees.filter((tree) => tree.details?.candidate);
      report.repositories.push({ name: repo.name, checkouts: inventory.worktrees.filter((tree) => !tree.isMain).length,
        candidates: candidates.length, bytes: candidates.reduce((sum, tree) => sum + (tree.details?.sizeBytes ?? 0), 0),
        href: `/repos/${encodeURIComponent(repo.name)}/git?tab=worktrees` });
      emit(`${repo.name}: ${candidates.length} checkout(s) suggested for review; nothing deleted.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan failed";
      report.errors.push({ name: repo.name, error: message });
      emit(`${repo.name}: ${message}`);
    }
  }
  await writeAtomic(reportPath(), JSON.stringify(report, null, 2));
  return report;
}
