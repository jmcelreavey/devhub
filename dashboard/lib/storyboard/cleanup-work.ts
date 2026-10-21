import fs from "node:fs";
import { getNotesDir } from "@/lib/content/dirs";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { cleanupWorktrees } from "@/lib/repos/worktree-maintenance";
import { listOrchestrations, mutateOrchestration, readOrchestration, withOrchestrationMutationLock, withOrchestrationWorkLock } from "./orchestration-store";

/** Keep review/fix checkouts until verification finishes. Branches and evidence survive cleanup. */
export async function cleanupFinishedAutoWork(
  taskId: string,
  notesDir = getNotesDir(),
  emit: (line: string) => void = (line) => console.info("[storyboard-cleanup]", line),
  dryRun = false,
): Promise<void> {
  await withOrchestrationWorkLock(taskId, notesDir, () =>
    withOrchestrationMutationLock(taskId, notesDir, async () => {
      const record = readOrchestration(taskId, notesDir);
      const auto = record?.auto;
      const tree = auto?.work?.worktree;
      if (record?.status !== "ready-for-review" || auto?.phase !== "ready" || !auto.verify?.reviewDone ||
        !(auto.verify.qaDone || auto.verify.qaSkipped) || !tree || !fs.existsSync(tree.path)) return;
      const branch = await runGitRepoAsync(tree.path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      if (branch.status !== 0 || !branch.stdout.trim()) throw new Error("Could not verify the checkout branch; kept");
      // Older agents renamed their branch. Save the actual branch before removing its checkout,
      // so Resume/Run verification can restore the same commits.
      const actualBranch = branch.stdout.trim();
      if (!dryRun && actualBranch !== tree.branch) {
        await mutateOrchestration(taskId, null, (current) => {
          if (!current?.auto?.work?.worktree) return null;
          current.auto.work.worktree.branch = actualBranch;
          return current;
        }, notesDir);
      }
      const result = await cleanupWorktrees(emit, { dryRun, release: { ...tree, branch: actualBranch, taskId } });
      if (result.errors.length) throw new Error(result.errors.join("; "));
    }));
}

/** Also retries cleanup skipped at completion because a terminal or service was still using the tree. */
export async function cleanupFinishedAutoWorktrees(emit: (line: string) => void, dryRun = false): Promise<string[]> {
  const { records, errors } = listOrchestrations();
  const failures = [...errors];
  for (const record of records.filter((item) => item.status === "ready-for-review")) {
    try { await cleanupFinishedAutoWork(record.taskId, undefined, emit, dryRun); }
    catch (error) {
      const message = `${record.taskId}: ${error instanceof Error ? error.message : "Cleanup failed"}`;
      failures.push(message);
      emit(message);
    }
  }
  return failures;
}
