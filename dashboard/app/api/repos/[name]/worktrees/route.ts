import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { withScannedRepo, type RepoParams } from "../git/_shared";
import { worktreeInventory, inspectWorktree, describeWorktree, loadWorktreeContext } from "@/lib/repos/worktree-inventory";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { parseWorktreeList } from "@/lib/repos/worktree-parsers";
import { withMutex } from "@/lib/atomic-write";
import { sweepPaseoWorkspacesQuietly } from "@/lib/paseo/workspaces";
import { loadMergedWorktreePrs, type MergedWorktreePrs } from "@/lib/repos/worktree-merge";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: NextRequest, { params }: RepoParams) => {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const taskId = req.nextUrl.searchParams.get("taskId") || undefined;
  if (taskId && !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) {
    return NextResponse.json({ error: "Invalid task" }, { status: 400 });
  }
  return NextResponse.json(await worktreeInventory(resolved.repoRoot, req.nextUrl.searchParams.get("details") === "1", taskId));
}, "worktrees.inventory");

const RemoveSchema = z.object({
  entries: z.array(z.object({ path: z.string().min(1).max(4096), head: z.string().regex(/^[a-f0-9]{40,64}$/) })).min(1).max(50),
  confirmed: z.literal(true),
  includeIgnored: z.boolean().default(false),
  mergedOnly: z.boolean().default(false),
});

export const POST = withErrorHandler(async (req: NextRequest, { params }: RepoParams) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const body = await parseBody(req, RemoveSchema);
  if (!body.ok) return body.response;
  return withMutex(`worktree-cleanup:${resolved.repoRoot}`, async () => {
    const removed: string[] = [];
    const errors: { path: string; error: string }[] = [];
    let merges: MergedWorktreePrs | undefined;
    for (const entry of body.data.entries) {
      try {
        // Re-read membership and safety immediately before each deletion. Never force.
        const listed = await runGitRepoAsync(resolved.repoRoot, ["worktree", "list", "--porcelain"]);
        if (listed.status !== 0) throw new Error("Could not refresh worktrees");
        const tree = parseWorktreeList(listed.stdout).find((item) => item.path === entry.path);
        if (!tree || tree.head !== entry.head) throw new Error("Checkout changed since preview. Refresh and review again.");
        if (tree.isMain || tree.locked || tree.prunable) throw new Error("Main, locked or missing checkouts cannot be removed here.");
        // Merge history is immutable; share one fresh lookup across this batch.
        merges ??= await loadMergedWorktreePrs(resolved.repoRoot, parseWorktreeList(listed.stdout)
          .filter((item) => body.data.entries.some((entry) => entry.path === item.path))
          .flatMap((item) => item.branch ? [item.branch] : []), true);
        const current = await inspectWorktree(describeWorktree(tree, loadWorktreeContext()), merges);
        if (body.data.mergedOnly && !current.merge?.verified) throw new Error(current.merge?.reason || "Could not verify a merged PR for this checkout");
        if (!current.details || current.details.blockers.length) throw new Error(current.details?.blockers.join("; ") || "Could not verify checkout");
        if (current.details.ignoredPaths.length && !body.data.includeIgnored) throw new Error("Review ignored local files before removing this checkout.");
        // GitHub and disk checks can take time; do not delete a moved HEAD.
        const refreshed = await runGitRepoAsync(resolved.repoRoot, ["worktree", "list", "--porcelain"]);
        const latest = parseWorktreeList(refreshed.stdout).find((item) => item.path === tree.path);
        if (refreshed.status !== 0 || !latest || latest.head !== entry.head || latest.locked || latest.branch !== tree.branch) {
          throw new Error("Checkout changed during review. Refresh and review again.");
        }
        const result = await runGitRepoAsync(resolved.repoRoot, ["worktree", "remove", "--", tree.path], { timeout: 120_000 });
        if (result.status !== 0) throw new Error(result.stderr || "Git refused to remove the checkout");
        removed.push(tree.path);
      } catch (error) {
        errors.push({ path: entry.path, error: error instanceof Error ? error.message : "Removal failed" });
      }
    }
    if (removed.length) await sweepPaseoWorkspacesQuietly();
    return NextResponse.json({ removed, errors });
  });
}, "worktrees.cleanup");
