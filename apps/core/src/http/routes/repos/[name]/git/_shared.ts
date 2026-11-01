import type { repoGitLogDashboard } from "../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../lib/actions/http";
import { detectUnmergedFiles } from "../../../../../lib/git/conflicts";
import { resolveScannedRepo } from "../../../../../lib/repos/scanned-repo";
import type { StashConflictPayload } from "../../../../../../../../packages/shared/repos/types";

export type RepoParams = { params: Promise<{ name: string }> };

export async function repoDashboardQueryHttp<RequestType extends Request>(
  action: typeof repoGitLogDashboard,
  request: RequestType,
  routeParams: RepoParams,
  read: (request: RequestType, routeParams: RepoParams) => Promise<Response>,
): Promise<Response> {
  const { name } = await routeParams.params;
  return httpAction(action, {
    input: () => ({ name, query: [...new URL(request.url).searchParams.entries()] }),
    context: () => ({ read: async () => {
      const response = await read(request, routeParams);
      return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
    } }),
    response: ({ status, body, headers }) => Response.json(body, { status, headers }),
  })(request);
}

export function withScannedRepo(
  name: string,
): { ok: true; repoRoot: string } | { ok: false; response: Response } {
  const repoRoot = resolveScannedRepo(name);
  if (!repoRoot) {
    return { ok: false, response: Response.json({ error: "Unknown repo" }, { status: 404 }) };
  }
  return { ok: true, repoRoot };
}

export function gitFail(result: { stderr: string; stdout: string }, fallback: string) {
  return Response.json(
    { error: result.stderr.trim() || result.stdout.trim() || fallback },
    { status: 500 },
  );
}

/**
 * Timestamped `devhub/backup-*` ref, taken before anything that rewrites the
 * branch pointer. Cheaper to reason about than reflog archaeology.
 */
export function backupBranchName(): string {
  return `devhub/backup-${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-")}`;
}

export function looksLikeStashConflict(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return /conflict/i.test(text) || /unmerged paths/i.test(text);
}

export async function stashConflictResponse(
  action: StashConflictPayload["action"],
  repoRoot: string,
  gitError: string,
  extras: { branch?: string; switched: boolean; syncTarget?: string; stashed?: boolean },
): Promise<Response> {
  const conflictFiles = (await detectUnmergedFiles(repoRoot)).map((f) => f.path);
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    branch: extras.branch,
    switched: extras.switched,
    conflictFiles,
    error: gitError || "Stash apply left conflicts",
    syncTarget: extras.syncTarget,
    stashed: extras.stashed,
  };
  return Response.json(payload, { status: 409 });
}
