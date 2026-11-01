import { repoGitStash, repoGitStashInput, repoGitStashList, type RepoGitStashResult } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { detectUnmergedFiles } from "../../../../../../lib/git/conflicts";
import {
  formatIndexLockError,
  looksLikeIndexLockError,
  prepareGitIndexWrite,
} from "../../../../../../lib/git/index-lock";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { parseStashList, parseUnifiedDiff } from "../../../../../../../../../packages/shared/ui-lib/repos/git-parsers";
import type { StashConflictPayload } from "../../../../../../../../../packages/shared/repos/types";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

function indexLockResponse(repoRoot: string, gitError?: string): Response {
  return Response.json(
    { error: formatIndexLockError(repoRoot, gitError), code: "index_lock" as const },
    { status: 409 },
  );
}

function looksLikeConflict(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return /conflict/i.test(text) || /unmerged paths/i.test(text);
}

async function stashConflict(
  action: StashConflictPayload["action"],
  repoRoot: string,
  gitError: string,
): Promise<Response> {
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    switched: false,
    conflictFiles: (await detectUnmergedFiles(repoRoot)).map((f) => f.path),
    error: gitError || "Stash left conflicts",
  };
  return Response.json(payload, { status: 409 });
}

function normalizeRef(ref?: string): string {
  if (!ref || typeof ref !== "string") return "stash@{0}";
  if (/^stash@\{\d+\}$/.test(ref)) return ref;
  if (/^\d+$/.test(ref)) return `stash@{${ref}}`;
  return ref;
}

function stashResponse(result: RepoGitStashResult): Response {
  return result.kind === "preview"
    ? Response.json({ error: result.message }, { status: 400 })
    : Response.json(result.response.body, { status: result.response.status });
}

export async function GET(req: Request, routeParams: RepoParams) {
  const { name } = await routeParams.params;
  return httpAction(repoGitStashList, {
    input: () => ({ name, action: "list" }),
    context: () => ({ stash: async () => {
      const result = await readStashes(req, routeParams);
      return { status: result.status, body: await result.json() };
    } }),
    response: stashResponse,
  })(req);
}

async function readStashes(_req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const list = await runGitRepoAsync(resolved.repoRoot, ["stash", "list", "--format=%gd%x00%gs"]);
  if (list.status !== 0) return gitFail(list, "Stash list failed");

  return Response.json({ stashes: parseStashList(list.stdout || "") });
}

export async function POST(req: Request, routeParams: RepoParams) {
  const { name } = await routeParams.params;
  const raw = await req.clone().json().catch(() => ({})) as Record<string, unknown> | null;
  const input = { name, action: raw?.action, ref: raw?.ref, message: raw?.message, confirm: true };
  const parsed = repoGitStashInput.safeParse(input);
  if (!parsed.success || parsed.data.action === "list") return applyStash(req, routeParams);
  return httpAction(repoGitStash, {
    input: () => parsed.data,
    context: () => ({ stash: async () => {
      const result = await applyStash(req, routeParams);
      return { status: result.status, body: await result.json() };
    } }),
    response: stashResponse,
  })(req);
}

async function applyStash(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    ref?: string;
    message?: string;
  };
  const ref = normalizeRef(body.ref);

  switch (body.action) {
    case "save": {
      const prep = prepareGitIndexWrite(repoRoot);
      if (!prep.ok) return indexLockResponse(repoRoot, prep.error);

      const args = ["stash", "push", "--include-untracked"];
      if (body.message?.trim()) args.push("-m", body.message.trim());
      const out = await runGitRepoAsync(repoRoot, args);
      if (out.status !== 0) {
        const gitError = out.stderr.trim() || out.stdout.trim() || "Stash save failed";
        if (looksLikeIndexLockError(out.stderr, out.stdout)) {
          return indexLockResponse(repoRoot, gitError);
        }
        return Response.json({ error: gitError }, { status: 500 });
      }
      return Response.json({ ok: true });
    }
    case "apply":
    case "pop": {
      const out = await runGitRepoAsync(repoRoot, ["stash", body.action, ref]);
      if (out.status !== 0) {
        const gitError = out.stderr.trim() || out.stdout.trim() || `Stash ${body.action} failed`;
        if ((await detectUnmergedFiles(repoRoot)).length > 0 || looksLikeConflict(out.stderr, out.stdout)) {
          return stashConflict("stash-apply", repoRoot, gitError);
        }
        return Response.json({ error: gitError }, { status: 500 });
      }
      return Response.json({ ok: true });
    }
    case "drop": {
      const out = await runGitRepoAsync(repoRoot, ["stash", "drop", ref]);
      if (out.status !== 0) return gitFail(out, "Stash drop failed");
      return Response.json({ ok: true });
    }
    case "show": {
      const out = await runGitRepoAsync(repoRoot, ["stash", "show", "-p", "--stat", ref]);
      if (out.status !== 0) return gitFail(out, "Stash show failed");
      const raw = out.stdout || "";
      return Response.json({ ref, raw, lines: parseUnifiedDiff(raw), empty: !raw.trim() });
    }
    default:
      return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
