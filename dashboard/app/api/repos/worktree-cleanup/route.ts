/**
 * Worktrees that are finished with, and removing one.
 *
 * Cross-repo, so it sits above `/api/repos/[name]/` rather than inside it —
 * the point of the surface is seeing every leftover checkout at once instead
 * of opening twelve repo pages to find them.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import { listWorktreeCleanup, removeWorktreeAt } from "@/lib/repos/worktree-cleanup";

export async function GET() {
  try {
    return NextResponse.json(await listWorktreeCleanup());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan worktrees";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const RemoveSchema = z.object({
  /** Local repo folder name owning the worktree. */
  repo: z.string().min(1),
  /** Absolute worktree path, as returned by GET. */
  path: z.string().min(1).max(4096),
  /** Remove even though the tree has uncommitted changes. */
  force: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, RemoveSchema);
  if (!parsed.ok) return parsed.response;
  const { repo, path: target, force } = parsed.data;

  const repoPath = resolveScannedRepo(repo);
  if (!repoPath) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const outcome = await removeWorktreeAt(repoPath, target, force);
  if (outcome.ok) return NextResponse.json({ ok: true });

  // Dirty is a distinct case: the UI can offer force rather than just failing.
  return NextResponse.json(
    { error: outcome.error, code: outcome.dirty ? "worktree_dirty" : undefined },
    { status: outcome.dirty ? 409 : 400 },
  );
}
