/**
 * One PR's live state — checks, reviews, merge — for MCP `events_wait`.
 *
 * A single `gh pr view` rather than the cached /prs list: the point of waiting
 * on a PR is noticing change, and a list cache is exactly what hides it.
 */
import { execGh } from "@/lib/gh-exec";

export interface PrCheckCounts {
  total: number;
  pending: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface PrState {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  reviewDecision: string | null;
  reviewCount: number;
  latestReview: { author: string; state: string; submittedAt: string } | null;
  checks: PrCheckCounts;
  failedChecks: string[];
}

/** CheckRun (`status`/`conclusion`) or StatusContext (`state`) from statusCheckRollup. */
interface RollupItem {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
}

interface GhPrView {
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string | null;
  reviews?: Array<{ author?: { login?: string } | null; state?: string; submittedAt?: string }>;
  statusCheckRollup?: RollupItem[] | null;
}

export const PR_REPO_RE = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

export function countChecks(items: readonly RollupItem[]): { counts: PrCheckCounts; failed: string[] } {
  const counts: PrCheckCounts = { total: 0, pending: 0, passed: 0, failed: 0, skipped: 0 };
  const failed: string[] = [];
  for (const item of items) {
    counts.total += 1;
    const name = item.name ?? item.context ?? "check";
    if (item.__typename === "StatusContext" || (item.status === undefined && item.state !== undefined)) {
      const state = (item.state ?? "").toUpperCase();
      if (state === "SUCCESS") counts.passed += 1;
      else if (state === "PENDING" || state === "EXPECTED") counts.pending += 1;
      else {
        counts.failed += 1;
        failed.push(name);
      }
      continue;
    }
    if ((item.status ?? "").toUpperCase() !== "COMPLETED") {
      counts.pending += 1;
      continue;
    }
    const conclusion = (item.conclusion ?? "").toUpperCase();
    if (conclusion === "SUCCESS") counts.passed += 1;
    else if (conclusion === "NEUTRAL" || conclusion === "SKIPPED") counts.skipped += 1;
    else {
      counts.failed += 1;
      failed.push(name);
    }
  }
  return { counts, failed };
}

export function parsePrState(repo: string, number: number, raw: GhPrView): PrState {
  const reviews = (raw.reviews ?? []).filter((r) => r.submittedAt);
  const latest = [...reviews].sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0];
  const { counts, failed } = countChecks(raw.statusCheckRollup ?? []);
  const state = (raw.state ?? "OPEN").toUpperCase();
  return {
    repo,
    number,
    title: raw.title ?? "",
    url: raw.url ?? `https://github.com/${repo}/pull/${number}`,
    state: state === "MERGED" || state === "CLOSED" ? state : "OPEN",
    isDraft: raw.isDraft === true,
    reviewDecision: raw.reviewDecision || null,
    reviewCount: reviews.length,
    latestReview: latest
      ? { author: latest.author?.login ?? "unknown", state: latest.state ?? "COMMENTED", submittedAt: latest.submittedAt ?? "" }
      : null,
    checks: counts,
    failedChecks: failed,
  };
}

export async function fetchPrState(repo: string, number: number): Promise<PrState> {
  if (!PR_REPO_RE.test(repo)) throw new Error("repo must be owner/name");
  const { stdout } = await execGh([
    "pr",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "title,url,state,isDraft,reviewDecision,reviews,statusCheckRollup",
  ]);
  return parsePrState(repo, number, JSON.parse(stdout) as GhPrView);
}
