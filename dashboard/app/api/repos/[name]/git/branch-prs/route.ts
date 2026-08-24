import { NextResponse } from "next/server";
import { summarizeChecks, type GhCheckRow } from "@/lib/github/branch-pr";
import { execGh } from "@/lib/gh-exec";
import { withScannedRepo, type RepoParams } from "../_shared";

interface GhPrRow {
  headRefName?: string;
  number?: number;
  title?: string;
  url?: string;
  statusCheckRollup?: GhCheckRow[];
}

export interface RailPr {
  headBranch: string;
  number: number;
  title: string;
  url: string;
  checks: string;
}

/**
 * Every open PR for the repo in one gh call — the rail stamps matching
 * branches with `#50 ✓` so review state is visible without leaving the
 * sidebar. Lazily fetched by the client (never in the hot path); any gh
 * failure degrades to an empty list.
 */
export async function GET(_req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  try {
    const { stdout } = await execGh(
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "headRefName,number,title,url,statusCheckRollup",
      ],
      { cwd: resolved.repoRoot },
    );
    const parsed: unknown = JSON.parse(stdout || "[]");
    const rows = Array.isArray(parsed) ? (parsed as GhPrRow[]) : [];
    const prs: RailPr[] = [];
    for (const row of rows) {
      const number = typeof row.number === "number" ? row.number : Number(row.number);
      if (!Number.isFinite(number) || !row.url || !row.headRefName) continue;
      prs.push({
        headBranch: row.headRefName,
        number,
        title: typeof row.title === "string" ? row.title : "",
        url: row.url,
        checks: summarizeChecks(row.statusCheckRollup).checks,
      });
    }
    return NextResponse.json({ prs });
  } catch {
    return NextResponse.json({ prs: [] as RailPr[] });
  }
}
