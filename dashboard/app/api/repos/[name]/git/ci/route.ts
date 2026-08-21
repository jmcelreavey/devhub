import { NextResponse, type NextRequest } from "next/server";
import { summarizeChecks, type GhCheckRow } from "@/lib/github/branch-pr";
import { execGh } from "@/lib/gh-exec";
import { withScannedRepo, type RepoParams } from "../_shared";

interface CheckRunsPayload {
  check_runs?: GhCheckRow[];
  status?: GhCheckRow;
}

/**
 * Rolled-up CI state for one commit, via `gh` (which expands the
 * `{owner}/{repo}` placeholders against the repo's own remote).
 *
 * Scoped to a single sha — the commit detail pane asks for exactly one — so
 * paging through history never spams the GitHub API. Any gh failure degrades
 * to `state: "none"`; the chip simply doesn't render.
 */
export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const commit = (req.nextUrl.searchParams.get("commit") ?? "").trim();
  if (!/^[0-9a-f]{7,40}$/.test(commit)) {
    return NextResponse.json({ error: "Invalid commit" }, { status: 400 });
  }

  try {
    const { stdout } = await execGh(
      ["api", `repos/{owner}/{repo}/commits/${commit}/check-runs`],
      { cwd: resolved.repoRoot },
    );
    const json = JSON.parse(stdout) as CheckRunsPayload;
    // A lone legacy commit status arrives under `status`; rollups normally
    // live in `check_runs`.
    const rows = json.check_runs ?? (json.status ? [json.status] : []);
    const { checks, checkCounts } = summarizeChecks(rows);
    return NextResponse.json({ state: checks, counts: checkCounts });
  } catch {
    return NextResponse.json({ state: "none" as const, reason: "github-unavailable" });
  }
}
