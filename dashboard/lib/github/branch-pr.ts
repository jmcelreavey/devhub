import { execGh } from "@/lib/gh-exec";

/** Rolled-up CI state for the PR head commit. */
export type PrChecksState = "passing" | "failing" | "pending" | "none";

export interface BranchOpenPr {
  number: number;
  title: string;
  url: string;
  /** Aggregate of every check run / commit status on the head commit. */
  checks: PrChecksState;
  /** Counts behind {@link checks}, for the tooltip. */
  checkCounts: { passed: number; failed: number; pending: number };
}

export interface WorkflowRun {
  status?: string;
  conclusion?: string;
  headSha?: string;
}

export interface GhCheckRow {
  /** Check runs use conclusion+status; commit statuses use state. */
  conclusion?: string;
  status?: string;
  state?: string;
}

interface GhPrListRow {
  number?: number;
  title?: string;
  url?: string;
  statusCheckRollup?: GhCheckRow[];
}

/**
 * Collapse gh's mixed check-run / commit-status rows into one state.
 *
 * Anything still running outranks a pass but not a failure: a PR with one
 * failed and one queued check is failing, and knowing that early is the point.
 */
export function summarizeChecks(rows: GhCheckRow[] | undefined): {
  checks: PrChecksState;
  checkCounts: { passed: number; failed: number; pending: number };
} {
  const counts = { passed: 0, failed: 0, pending: 0 };
  for (const row of rows ?? []) {
    const verdict = (row.conclusion || row.state || "").toUpperCase();
    const status = (row.status || "").toUpperCase();
    if (!verdict && status && status !== "COMPLETED") {
      counts.pending += 1;
    } else if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(verdict)) {
      counts.passed += 1;
    } else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(verdict)) {
      counts.failed += 1;
    } else if (verdict === "PENDING" || verdict === "EXPECTED" || status === "IN_PROGRESS") {
      counts.pending += 1;
    }
  }
  const checks: PrChecksState =
    counts.failed > 0 ? "failing"
    : counts.pending > 0 ? "pending"
    : counts.passed > 0 ? "passing"
    : "none";
  return { checks, checkCounts: counts };
}

export function summarizeWorkflowRuns(
  runs: WorkflowRun[],
  currentHeadSha?: string | null,
): "passing" | "pending" | "failing" | "unknown" {
  const headSha = currentHeadSha ?? runs.find((run) => run.headSha)?.headSha;
  const headRuns = headSha ? runs.filter((run) => run.headSha === headSha) : [];
  if (headRuns.length === 0) return "unknown";
  if (headRuns.some((run) => run.conclusion && !["success", "neutral", "skipped"].includes(run.conclusion))) return "failing";
  if (headRuns.some((run) => run.status !== "completed")) return "pending";
  return headRuns.every((run) => ["success", "neutral", "skipped"].includes(run.conclusion ?? "")) ? "passing" : "unknown";
}

/**
 * Open PR whose head branch matches `headBranch` in the local clone (`gh pr list`).
 * Returns null when none, or when gh fails / the clone isn't a GitHub remote.
 */
export async function findOpenPrForHeadBranch(
  repoPath: string,
  headBranch: string,
): Promise<BranchOpenPr | null> {
  const branch = headBranch.trim();
  if (!branch || branch === "HEAD") return null;

  try {
    const { stdout } = await execGh(
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--limit",
        "1",
        "--json",
        "number,title,url,statusCheckRollup",
      ],
      { cwd: repoPath },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const row = parsed[0] as GhPrListRow;
    const number = typeof row.number === "number" ? row.number : Number(row.number);
    const title = typeof row.title === "string" ? row.title : "";
    const url = typeof row.url === "string" ? row.url : "";
    if (!Number.isFinite(number) || !url) return null;
    return { number, title, url, ...summarizeChecks(row.statusCheckRollup) };
  } catch {
    return null;
  }
}
