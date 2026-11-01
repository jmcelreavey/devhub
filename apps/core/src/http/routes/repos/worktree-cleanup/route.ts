/**
 * Worktrees that are finished with, and removing one.
 *
 * Cross-repo, so it sits above `/api/repos/[name]/` rather than inside it —
 * the point of the surface is seeing every leftover checkout at once instead
 * of opening twelve repo pages to find them.
 */
import { z } from "zod";
import { repoWorktreeCleanup, repoWorktreeCleanupInput, repoWorktreeCleanupList, repoWorktreeSingleRemove, repoWorktreeSingleRemoveInput, type RepoWorktreeCleanupItem, type RepoWorktreeCleanupResult } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { parseBody } from "../../../../lib/api-utils";
import { resolveScannedRepo } from "../../../../lib/repos/scanned-repo";
import { sweepPaseoWorkspacesQuietly } from "../../../../lib/paseo/workspaces";
import { listWorktreeCleanup, removeWorktreeAt, removeWorktrees, worktreeRemovalBlocker } from "../../../../lib/repos/worktree-cleanup";

async function listCleanup() {
  try {
    return { status: 200, body: await listWorktreeCleanup() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan worktrees";
    return { status: 500, body: { error: message } };
  }
}

async function removeCleanupItems(items: RepoWorktreeCleanupItem[], dryRun?: boolean) {
  const result = await removeWorktrees(items, resolveScannedRepo, { dryRun });
  if (!dryRun && result.removed.length) await sweepPaseoWorkspacesQuietly();
  return { status: 200, body: { ok: true, ...result } };
}

function cleanupResponse(result: RepoWorktreeCleanupResult): Response {
  return result.kind === "rejected"
    ? Response.json({ error: result.message }, { status: 400 })
    : Response.json(result.response.body, { status: result.response.status });
}

export const GET = httpAction(repoWorktreeCleanupList, {
  input: () => ({ action: "list" }),
  context: () => ({ list: listCleanup, remove: removeCleanupItems }),
  response: cleanupResponse,
});

const BulkSchema = repoWorktreeCleanupInput.pick({ items: true, dryRun: true }).required({ items: true });

export async function POST(req: Request) {
  const parsed = await parseBody(req, z.union([BulkSchema, repoWorktreeSingleRemoveInput]));
  if (!parsed.ok) return parsed.response;
  if ("items" in parsed.data) {
    const body = parsed.data;
    return httpAction(repoWorktreeCleanup, {
      input: () => ({ action: "remove", items: body.items, dryRun: body.dryRun, confirm: true }),
      context: () => ({ list: listCleanup, remove: removeCleanupItems }),
      response: cleanupResponse,
    })(req);
  }
  const body = parsed.data;
  return httpAction(repoWorktreeSingleRemove, {
    input: () => body,
    context: () => ({ removeSingle: async (input) => {
      const response = await removeSingleWorktree(input);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function removeSingleWorktree({ repo, path: target, force }: z.output<typeof repoWorktreeSingleRemoveInput>): Promise<Response> {

  const repoPath = resolveScannedRepo(repo);
  if (!repoPath) return Response.json({ error: "Repo not found" }, { status: 404 });

  // A run still going needs its checkout; force only ever overrides uncommitted changes.
  const blocker = await worktreeRemovalBlocker(target);
  if (blocker?.code === "run_active") {
    return Response.json({ error: `Not removed: ${blocker.reason}.`, code: "run_active" }, { status: 409 });
  }

  const outcome = await removeWorktreeAt(repoPath, target, force);
  if (outcome.ok) {
    await sweepPaseoWorkspacesQuietly();
    return Response.json({ ok: true });
  }

  // Dirty is a distinct case: the UI can offer force rather than just failing.
  return Response.json(
    { error: outcome.error, code: outcome.dirty ? "worktree_dirty" : undefined },
    { status: outcome.dirty ? 409 : 400 },
  );
}
