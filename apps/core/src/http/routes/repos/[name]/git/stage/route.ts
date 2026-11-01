import { repoGitDashboardStageHunk, repoGitDashboardStageHunkInput, repoGitDiscard, repoGitStage, repoGitStageHunk, repoGitStageHunkInput, type RepoGitMutationResponse } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { detectUnmergedFiles } from "../../../../../../lib/git/conflicts";
import { discardGitPaths, type DiscardScope } from "../../../../../../lib/git/discard";
import { stageDiffHunk } from "../../../../../../lib/git/patch-stage";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { withRepoGitMutation } from "../../../../../../lib/git/mutation-queue";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

interface StageActionBody {
  action?: string;
  path?: string;
  paths?: string[];
  scope?: DiscardScope;
  rawDiff?: string;
  hunkIndex?: number;
  lineIndexes?: number[];
}

function mutationResponse(result: { kind: "preview"; message: string } | { kind: "executed"; response: RepoGitMutationResponse }): Response {
  return result.kind === "executed"
    ? Response.json(result.response.body, { status: result.response.status })
    : Response.json({ error: result.message }, { status: 400 });
}

/**
 * Unstage / discard are not git operations on a conflicted path — the index
 * holds stage1/2/3 entries until the file is staged (resolved). `git restore
 * --staged` fails on them with a raw "is unmerged" error per path, which read
 * like five unrelated bugs. Catch it upfront and say what to do instead.
 */
async function unmergedGuard(repoRoot: string, paths: string[]): Promise<Response | null> {
  if (paths.length === 0) return null;
  const unmerged = new Set((await detectUnmergedFiles(repoRoot)).map((f) => f.path));
  const hit = paths.filter((p) => unmerged.has(p));
  if (hit.length === 0) return null;
  const names = hit.slice(0, 3).join(", ");
  return Response.json(
    {
      code: "unmerged",
      conflictFiles: hit,
      error:
        `${hit.length} path${hit.length === 1 ? " is" : "s are"} still in conflict (${names}${hit.length > 3 ? "…" : ""}). ` +
        "Resolve them in the Conflicts tab (or stage to mark resolved) — unstaging a conflicted file would re-create the conflict.",
    },
    { status: 409 },
  );
}

export async function POST(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as StageActionBody;

  const paths = [
    ...(typeof body.path === "string" && body.path ? [body.path] : []),
    ...(Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : []),
  ];

  if (paths.some((p) => p.includes("..") || p.startsWith("/"))) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  const executeMutation = async () => {
    const response = await withRepoGitMutation(repoRoot, () => applyStageAction(repoRoot, body, paths));
    return { status: response.status, body: await response.json() };
  };

  if (body.action === "stage" || body.action === "unstage") {
    return httpAction(repoGitStage, {
      input: () => ({ name, action: body.action, paths, confirm: true }),
      context: () => ({ stage: executeMutation }),
      response: mutationResponse,
    })(req);
  }

  if (body.action === "discard" && paths.length > 0) {
    const scope = body.scope;
    if (scope !== "staged" && scope !== "unstaged") {
      return Response.json({ error: "Discard scope must be staged or unstaged" }, { status: 400 });
    }
    return httpAction(repoGitDiscard, {
      input: () => ({ name, paths, scope, confirm: true }),
      context: () => ({ discard: executeMutation }),
      response: mutationResponse,
    })(req);
  }

  if (body.action === "stage-hunk" || body.action === "unstage-hunk") {
    const input = {
      name,
      action: body.action,
      path: paths[0],
      rawDiff: body.rawDiff,
      hunkIndex: body.hunkIndex,
      lineIndexes: Array.isArray(body.lineIndexes) ? body.lineIndexes.filter((index) => typeof index === "number" && index > 0) : undefined,
      confirm: true,
    };
    if (repoGitStageHunkInput.safeParse(input).success) {
      return httpAction(repoGitStageHunk, {
        input: () => input,
        context: () => ({ stageHunk: executeMutation }),
        response: mutationResponse,
      })(req);
    }
    if (repoGitDashboardStageHunkInput.safeParse(input).success) {
      return httpAction(repoGitDashboardStageHunk, {
        input: () => input,
        context: () => ({ stageHunk: executeMutation }),
        response: ({ status, body }) => Response.json(body, { status }),
      })(req);
    }
  }

  return withRepoGitMutation(repoRoot, () => applyStageAction(repoRoot, body, paths));
}

async function applyStageAction(repoRoot: string, body: StageActionBody, paths: string[]) {
  switch (body.action) {
    case "stage": {
      if (paths.length === 0) {
        const out = await runGitRepoAsync(repoRoot, ["add", "-A"]);
        if (out.status !== 0) return gitFail(out, "Stage failed");
        return Response.json({ ok: true });
      }
      const out = await runGitRepoAsync(repoRoot, ["add", "--", ...paths]);
      if (out.status !== 0) return gitFail(out, "Stage failed");
      return Response.json({ ok: true });
    }
    case "unstage": {
      if (paths.length === 0) {
        const out = await runGitRepoAsync(repoRoot, ["reset", "HEAD"]);
        if (out.status !== 0) return gitFail(out, "Unstage failed");
        return Response.json({ ok: true });
      }
      const blocked = await unmergedGuard(repoRoot, paths);
      if (blocked) return blocked;
      const out = await runGitRepoAsync(repoRoot, ["restore", "--staged", "--", ...paths]);
      if (out.status !== 0) return gitFail(out, "Unstage failed");
      return Response.json({ ok: true });
    }
    case "discard": {
      if (paths.length === 0) {
        return Response.json({ error: "path required for discard" }, { status: 400 });
      }
      const blocked = await unmergedGuard(repoRoot, paths);
      if (blocked) return blocked;
      const scope = body.scope;
      if (scope !== "staged" && scope !== "unstaged") {
        return Response.json({ error: "Discard scope must be staged or unstaged" }, { status: 400 });
      }
      const result = await discardGitPaths(repoRoot, paths, scope);
      if (!result.ok) {
        return Response.json({ error: result.error || "Discard failed" }, { status: result.conflict ? 409 : 500 });
      }
      return Response.json({ ok: true, scope });
    }
    case "stage-hunk":
    case "unstage-hunk": {
      const filePath = paths[0];
      if (!filePath) {
        return Response.json({ error: "path required for hunk staging" }, { status: 400 });
      }
      if (typeof body.rawDiff !== "string" || !body.rawDiff.trim()) {
        return Response.json({ error: "rawDiff required" }, { status: 400 });
      }
      if (typeof body.hunkIndex !== "number" || body.hunkIndex < 0) {
        return Response.json({ error: "hunkIndex required" }, { status: 400 });
      }
      const lineIndexes = Array.isArray(body.lineIndexes)
        ? body.lineIndexes.filter((n): n is number => typeof n === "number" && n > 0)
        : undefined;
      const result = await stageDiffHunk({
        repoRoot,
        rawDiff: body.rawDiff,
        filePath,
        hunkIndex: body.hunkIndex,
        lineIndexes: lineIndexes && lineIndexes.length > 0 ? lineIndexes : undefined,
        reverse: body.action === "unstage-hunk",
      });
      if (!result.ok) {
        return Response.json({ error: result.error }, { status: 500 });
      }
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
