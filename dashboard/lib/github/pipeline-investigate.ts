/**
 * Start a pipeline-investigate agent job for one PR (P5).
 *
 * Same default-provider seam as auto-review; prompt uses the
 * devhub-fix-pipeline skill. Optional confirm-gated re-run of failed Actions runs.
 */
import { startBackgroundAgent } from "@/lib/agent-runs/background";
import { execGh } from "@/lib/gh-exec";
import type { GithubPrRow } from "@/lib/github/prs";
import { getNotesDir } from "@/lib/notes/dir";
import { prNotePath } from "@/lib/pr-note";
import { agentPipelineInvestigatePrompt } from "@/lib/pr-pipeline-prompt";

export interface PipelineInvestigateStartResult {
  /** Agent run id (CLI providers). */
  runId?: string;
  /** OpenCode session id. */
  sessionId?: string;
  conversationId?: string;
  providerLabel: string;
  notePath: string;
  prompt: string;
}

export function pipelineInvestigateNotePath(row: Pick<GithubPrRow, "repo" | "number">): string {
  return prNotePath({ repo: row.repo, number: row.number });
}

/** Start pipeline investigate on the default AI provider. Does not post GitHub reviews. */
export async function startPipelineInvestigateAgent(opts: {
  row: Pick<GithubPrRow, "repo" | "number" | "url" | "title">;
  notePath?: string;
}): Promise<PipelineInvestigateStartResult> {
  const notePath = opts.notePath ?? pipelineInvestigateNotePath(opts.row);
  const prompt = agentPipelineInvestigatePrompt(opts.row.url, notePath);
  const started = await startBackgroundAgent({
    prompt: `${prompt}\n\n(Write findings via notes MCP to path: ${notePath})`,
    title: `Pipeline PR #${opts.row.number}`,
    cwd: getNotesDir(),
    activity: { source: "investigation", action: "pipeline", prUrl: opts.row.url, repoName: opts.row.repo, notePath },
  });
  const ids = { runId: started.runId, conversationId: started.conversationId };
  return { ...ids, providerLabel: started.providerLabel, notePath, prompt };
}

export interface RerunFailedResult {
  attempted: number;
  reran: number;
  runIds: number[];
  errors: string[];
}

/**
 * Best-effort: re-run failed workflow runs for the PR head branch.
 * Pure selection helper is unit-tested; this hits `gh`.
 */
export async function rerunFailedChecksForPr(repo: string, number: number): Promise<RerunFailedResult> {
  const { stdout } = await execGh([
    "pr",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "headRefName",
  ]);
  const headRefName = (JSON.parse(stdout) as { headRefName?: string }).headRefName?.trim();
  if (!headRefName) {
    return { attempted: 0, reran: 0, runIds: [], errors: ["PR has no headRefName"] };
  }

  const list = await execGh([
    "run",
    "list",
    "--repo",
    repo,
    "--branch",
    headRefName,
    "--status",
    "failure",
    "--limit",
    "5",
    "--json",
    "databaseId,name,status,conclusion",
  ]);
  const runs = JSON.parse(list.stdout) as Array<{ databaseId?: number }>;
  const runIds = runs
    .map((r) => r.databaseId)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id));

  const errors: string[] = [];
  let reran = 0;
  for (const id of runIds) {
    try {
      await execGh(["run", "rerun", String(id), "--repo", repo, "--failed"]);
      reran += 1;
    } catch (err) {
      errors.push(`run ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { attempted: runIds.length, reran, runIds, errors };
}

/** Select which failed run IDs to re-run (cap) — pure for tests. */
export function selectFailedRunIds(
  runs: ReadonlyArray<{ databaseId?: number; conclusion?: string | null; status?: string | null }>,
  limit = 5,
): number[] {
  const ids: number[] = [];
  for (const run of runs) {
    if (ids.length >= limit) break;
    const id = run.databaseId;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    const conclusion = (run.conclusion ?? "").toLowerCase();
    const status = (run.status ?? "").toLowerCase();
    if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") {
      ids.push(id);
      continue;
    }
    // Already filtered by --status failure usually; keep status-based fallback.
    if (status === "completed" && conclusion && conclusion !== "success") ids.push(id);
  }
  return ids;
}
