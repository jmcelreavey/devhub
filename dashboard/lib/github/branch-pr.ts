import { execGh } from "@/lib/gh-exec";

export interface BranchOpenPr {
  number: number;
  title: string;
  url: string;
}

interface GhPrListRow {
  number?: number;
  title?: string;
  url?: string;
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
        "number,title,url",
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
    return { number, title, url };
  } catch {
    return null;
  }
}
