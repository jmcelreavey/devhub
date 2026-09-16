/**
 * Start a pipeline-investigate agent job for one PR (P5).
 *
 * Same OpenCode seam as auto-review; prompt uses the devhub-fix-pipeline skill.
 * Optional confirm-gated re-run of failed Actions runs.
 */
import { ensureDevHubOpenCode } from "@/lib/opencode/listen";
import { agentPipelineInvestigatePrompt } from "@/lib/pr-pipeline-prompt";
import { prNotePath } from "@/lib/pr-note";
import { execGh } from "@/lib/gh-exec";
import type { GithubPrRow } from "@/lib/github/prs";

export interface PipelineInvestigateStartResult {
  sessionId: string;
  notePath: string;
  prompt: string;
}

function opencodeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const password = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  }
  return headers;
}

export function pipelineInvestigateNotePath(row: Pick<GithubPrRow, "repo" | "number">): string {
  return prNotePath({ repo: row.repo, number: row.number });
}

/** Start one OpenCode session for pipeline investigate. Does not post GitHub reviews. */
export async function startOpenCodePipelineInvestigate(opts: {
  row: Pick<GithubPrRow, "repo" | "number" | "url" | "title">;
  notePath?: string;
}): Promise<PipelineInvestigateStartResult> {
  const notePath = opts.notePath ?? pipelineInvestigateNotePath(opts.row);
  const prompt = agentPipelineInvestigatePrompt(opts.row.url, notePath);
  const text = `${prompt}\n\n(Write findings via notes MCP to path: ${notePath})`;
  const title = `Pipeline PR #${opts.row.number}`.slice(0, 80);
  const base = `http://127.0.0.1:${await ensureDevHubOpenCode()}`;
  const headers = opencodeHeaders();

  const sessionRes = await fetch(`${base}/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  if (!sessionRes.ok) {
    throw new Error(`OpenCode session create failed (${sessionRes.status})`);
  }
  const session = (await sessionRes.json()) as { id?: string };
  if (!session.id) throw new Error("OpenCode returned no session id");

  const promptRes = await fetch(`${base}/session/${session.id}/prompt_async`, {
    method: "POST",
    headers,
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
  });
  if (!promptRes.ok && promptRes.status !== 204) {
    throw new Error(`OpenCode prompt failed (${promptRes.status})`);
  }
  return { sessionId: session.id, notePath, prompt };
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
