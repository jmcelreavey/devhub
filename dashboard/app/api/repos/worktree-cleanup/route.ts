/**
 * Worktrees that are finished with, and removing one.
 *
 * Cross-repo, so it sits above `/api/repos/[name]/` rather than inside it —
 * the point of the surface is seeing every leftover checkout at once instead
 * of opening twelve repo pages to find them.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import { sweepPaseoWorkspacesQuietly } from "@/lib/paseo/workspaces";
import { listWorktreeCleanup, removeWorktreeAt, removeWorktrees, worktreeRemovalBlocker } from "@/lib/repos/worktree-cleanup";

export const GET = withErrorHandler<[request?: Request]>(async () => {
  try {
    return NextResponse.json(await listWorktreeCleanup());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan worktrees";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "worktree-cleanup.get");

const RemoveSchema = z.object({
  /** Local repo folder name owning the worktree. */
  repo: z.string().min(1),
  /** Absolute worktree path, as returned by GET. */
  path: z.string().min(1).max(4096),
  /** Remove even though the tree has uncommitted changes. */
  force: z.boolean().optional(),
});

const BulkSchema = z.object({
  /** Worktrees to remove, as returned by GET. Never forced: dirty or busy ones are skipped with a reason. */
  items: z.array(z.object({ repo: z.string().min(1), path: z.string().min(1).max(4096) })).min(1).max(200),
  /** Report what would be removed and skipped, without touching anything. */
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, z.union([BulkSchema, RemoveSchema]));
  if (!parsed.ok) return parsed.response;
  if ("items" in parsed.data) {
    const result = await removeWorktrees(parsed.data.items, resolveScannedRepo, { dryRun: parsed.data.dryRun });
    if (!parsed.data.dryRun && result.removed.length) await sweepPaseoWorkspacesQuietly();
    return NextResponse.json({ ok: true, ...result });
  }
  const { repo, path: target, force } = parsed.data;

  const repoPath = resolveScannedRepo(repo);
  if (!repoPath) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  // A run still going needs its checkout; force only ever overrides uncommitted changes.
  const blocker = await worktreeRemovalBlocker(target);
  if (blocker?.code === "run_active") {
    return NextResponse.json({ error: `Not removed: ${blocker.reason}.`, code: "run_active" }, { status: 409 });
  }

  const outcome = await removeWorktreeAt(repoPath, target, force);
  if (outcome.ok) {
    await sweepPaseoWorkspacesQuietly();
    return NextResponse.json({ ok: true });
  }

  // Dirty is a distinct case: the UI can offer force rather than just failing.
  return NextResponse.json(
    { error: outcome.error, code: outcome.dirty ? "worktree_dirty" : undefined },
    { status: outcome.dirty ? 409 : 400 },
  );
}
