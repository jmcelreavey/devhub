import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { getNotesAiCallOptions, getNotesAiModel } from "@/lib/ai/provider";
import { safeReadJSON, writeAtomic } from "@/lib/atomic-write";
import { execGh } from "@/lib/gh-exec";
import { summarizeChecks, summarizeWorkflowRuns, type WorkflowRun } from "@/lib/github/branch-pr";
import { analyzeChangeImpact } from "@/lib/repos/change-impact";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { getNotesDir } from "@/lib/notes/dir";
import { getGithubLogin } from "@/lib/standup/github-merged";
import { pMap } from "@/lib/p-limit";
import { codeownersForPath, deriveDomains, domainForPath, readCodeowners } from "./domains";
import { attentionSummary, type AttentionSummary } from "./obligations";
import { readLearnedDomains, resolveOwnedRepo, resolveOwnedRepos } from "./owned-repos";
import { deriveTeams, needsChurnInference, teamForDomains } from "./teams";
import type {
  DomainContribution,
  KnowledgeGap,
  OwnerBrief,
  RepoDigest,
  RepoDomain,
  RepoObligations,
  RepoPrRadarRow,
  RepoTeam,
  ResolvedOwnedRepo,
} from "./types";

/**
 * Thrown when a route is asked about a repo the user does not own. Routes map it
 * to a 404 so the UI can offer to start owning it, rather than surfacing a 500.
 */
export class OwnedRepoNotFoundError extends Error {
  constructor(fullName: string) {
    super(`${fullName} is not an owned repository`);
    this.name = "OwnedRepoNotFoundError";
  }
}

interface GhPrRow {
  number?: number;
  title?: string;
  url?: string;
  author?: { login?: string; name?: string; is_bot?: boolean };
  createdAt?: string;
  updatedAt?: string;
  isDraft?: boolean;
  files?: { path?: string; additions?: number; deletions?: number }[];
  latestReviews?: { author?: { login?: string }; state?: string }[];
  reviewDecision?: string;
  reviewRequests?: { login?: string; name?: string; slug?: string }[];
  statusCheckRollup?: { conclusion?: string; status?: string; state?: string }[];
}

interface ParsedCommit {
  sha: string;
  subject: string;
  committedAt: string;
  email: string;
  files: string[];
}

interface DigestCache extends RepoDigest {
  fullName: string;
}

const PR_TTL_MS = 2 * 60_000;
const OBLIGATION_TTL_MS = 60_000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function parseJsonArray<T>(stdout: string): T[] {
  const parsed: unknown = JSON.parse(stdout || "[]");
  return Array.isArray(parsed) ? parsed as T[] : [];
}

function mapPr(
  row: GhPrRow,
  login: string | null,
  domains: RepoDomain[],
  teams: RepoTeam[],
  codeowners: ReturnType<typeof readCodeowners>,
): RepoPrRadarRow {
  const files = (row.files ?? []).flatMap((file) =>
    file.path ? [{ path: file.path, additions: file.additions ?? 0, deletions: file.deletions ?? 0 }] : [],
  );
  const touchedDomains = [...new Set(files.flatMap((file) => {
    const domain = domainForPath(domains, file.path);
    return domain ? [domain.id] : [];
  }))];
  const reviewedBy = [...new Set((row.latestReviews ?? []).flatMap((review) =>
    review.author?.login ? [review.author.login] : [],
  ))];
  const reviewRequests = row.reviewRequests ?? [];
  const mineRequested = Boolean(login && reviewRequests.some((request) =>
    request.login?.toLowerCase() === login.toLowerCase(),
  ));
  const createdAt = row.createdAt ?? new Date().toISOString();
  const ageMs = Date.now() - new Date(row.updatedAt ?? createdAt).getTime();
  const checks = summarizeChecks(row.statusCheckRollup).checks;
  return {
    number: row.number ?? 0,
    title: row.title ?? "Untitled pull request",
    url: row.url ?? "",
    author: { login: row.author?.login ?? row.author?.name ?? "unknown", avatarUrl: null },
    createdAt,
    updatedAt: row.updatedAt ?? createdAt,
    isDraft: row.isDraft === true,
    files,
    domains: touchedDomains,
    team: teamForDomains(teams, touchedDomains),
    review: {
      mineRequested,
      reviewedBy,
      nobodyLooking: reviewedBy.length === 0 && reviewRequests.length === 0,
      decision: row.reviewDecision ?? null,
    },
    checks,
    stale: ageMs > 3 * 24 * 60 * 60 * 1000 && reviewedBy.length === 0,
    uncoveredPaths: files.filter((file) => codeownersForPath(codeowners, file.path).length === 0).map((file) => file.path),
  };
}

const prCache = new Map<string, { expiresAt: number; rows: RepoPrRadarRow[] }>();

export async function loadPrRadar(
  repo: ResolvedOwnedRepo,
  precomputed?: { domains: RepoDomain[]; teams: RepoTeam[] },
): Promise<RepoPrRadarRow[]> {
  const key = repo.fullName.toLowerCase();
  const cached = prCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const domains = precomputed?.domains
    ?? (repo.localPath ? await deriveDomains(repo.localPath, repo.domains) : []);
  const teams = precomputed?.teams ?? await resolveTeams(repo, domains);
  const [login, result] = await Promise.all([
    getGithubLogin(),
    execGh([
      "pr", "list", "--repo", repo.fullName, "--state", "open", "--limit", "100", "--json",
      "number,title,url,author,createdAt,updatedAt,isDraft,files,latestReviews,reviewDecision,reviewRequests,statusCheckRollup",
    ]),
  ]);
  const codeowners = repo.localPath ? readCodeowners(repo.localPath) : [];
  const rows = parseJsonArray<GhPrRow>(result.stdout).map((row) => mapPr(row, login, domains, teams, codeowners));
  prCache.set(key, { expiresAt: Date.now() + PR_TTL_MS, rows });
  return rows;
}

async function defaultBranchCi(repo: ResolvedOwnedRepo): Promise<RepoObligations["defaultBranchCi"]> {
  if (!repo.defaultBranch) return "unknown";
  const [runs, head] = await Promise.all([
    execGh([
      "run", "list", "--repo", repo.fullName, "--branch", repo.defaultBranch, "--limit", "20", "--json", "status,conclusion,headSha",
    ]),
    execGh(["api", `repos/${repo.fullName}/commits/${encodeURIComponent(repo.defaultBranch)}`, "--jq", ".sha"]),
  ]);
  return summarizeWorkflowRuns(parseJsonArray<WorkflowRun>(runs.stdout), head.stdout.trim() || null);
}

export const summarizeDefaultBranchRuns = summarizeWorkflowRuns;

async function staleLocalBranches(repo: ResolvedOwnedRepo): Promise<{ name: string; lastCommitAt: string }[]> {
  if (!repo.localPath) return [];
  const [result, mergedResult] = await Promise.all([
    runGitRepoAsync(repo.localPath, [
      "for-each-ref", "--format=%(refname:short)%00%(committerdate:iso-strict)", "refs/heads",
    ]),
    repo.defaultBranch
      ? runGitRepoAsync(repo.localPath, ["branch", "--format=%(refname:short)", "--merged", `refs/remotes/origin/${repo.defaultBranch}`])
      : Promise.resolve({ status: 1, stdout: "", stderr: "" }),
  ]);
  if (result.status !== 0) return [];
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const merged = new Set(mergedResult.stdout.split("\n").map((branch) => branch.trim()).filter(Boolean));
  return result.stdout.split("\n").flatMap((line) => {
    const [name, lastCommitAt] = line.split("\0");
    if (!name || !lastCommitAt || name === repo.defaultBranch || merged.has(name) || new Date(lastCommitAt).getTime() >= cutoff) return [];
    return [{ name, lastCommitAt }];
  }).slice(0, 20);
}

async function unassignedIssues(fullName: string): Promise<number> {
  const query = encodeURIComponent(`repo:${fullName} is:issue state:open no:assignee`);
  const { stdout } = await execGh(["api", `/search/issues?per_page=1&q=${query}`]);
  return (JSON.parse(stdout) as { total_count?: number }).total_count ?? 0;
}

const obligationCache = new Map<string, { expiresAt: number; value: Promise<RepoObligations> }>();

export function loadObligations(
  repo: ResolvedOwnedRepo,
  prs: RepoPrRadarRow[],
): Promise<RepoObligations> {
  const key = repo.fullName.toLowerCase();
  const cached = obligationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = loadObligationsUncached(repo, prs).catch((error: unknown) => {
    obligationCache.delete(key);
    throw error;
  });
  obligationCache.set(key, { expiresAt: Date.now() + OBLIGATION_TTL_MS, value });
  return value;
}

async function loadObligationsUncached(
  repo: ResolvedOwnedRepo,
  prs: RepoPrRadarRow[],
): Promise<RepoObligations> {
  const [ci, branches, issues] = await Promise.allSettled([
    defaultBranchCi(repo),
    staleLocalBranches(repo),
    unassignedIssues(repo.fullName),
  ]);
  return {
    defaultBranchCi: ci.status === "fulfilled" ? ci.value : "unknown",
    staleBranches: branches.status === "fulfilled" ? branches.value : [],
    botPrs: prs.filter((pr) => /dependabot|renovate/i.test(pr.author.login)).length,
    unassignedIssues: issues.status === "fulfilled" ? issues.value : null,
    partial: [ci, branches, issues].some((result) => result.status === "rejected"),
  };
}

function parseCommits(stdout: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  let current: ParsedCommit | null = null;
  for (const rawLine of stdout.split("\n")) {
    if (rawLine.startsWith("\u001e")) {
      if (current) commits.push(current);
      const [sha = "", subject = "", committedAt = "", email = ""] = rawLine.slice(1).split("\0");
      current = { sha, subject, committedAt, email: email.toLowerCase(), files: [] };
      continue;
    }
    const filePath = rawLine.trim();
    if (filePath && current) current.files.push(filePath);
  }
  if (current) commits.push(current);
  return commits;
}

async function recentCommits(repoRoot: string, rangeArgs: string[]): Promise<ParsedCommit[]> {
  const result = await runGitRepoAsync(repoRoot, [
    "log", "--name-only", "--no-renames", "--format=%x1e%H%x00%s%x00%aI%x00%ae", ...rangeArgs,
  ], { timeout: 30_000 });
  return result.status === 0 ? parseCommits(result.stdout) : [];
}

/**
 * Ninety days of commits with their touched files. Shared by the gap ledger and
 * churn-based team inference so a page load walks the log once, not twice.
 */
const ACTIVITY_TTL_MS = 5 * 60_000;
const activityCache = new Map<string, { expiresAt: number; commits: Promise<ParsedCommit[]> }>();

function loadRepoActivity(repo: ResolvedOwnedRepo): Promise<ParsedCommit[]> {
  if (!repo.localPath) return Promise.resolve([]);
  const key = repo.fullName.toLowerCase();
  const cached = activityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.commits;
  const commits = recentCommits(repo.localPath, ["--since=90 days ago", "--all"]).catch((error: unknown) => {
    activityCache.delete(key);
    throw error;
  });
  activityCache.set(key, { expiresAt: Date.now() + ACTIVITY_TTL_MS, commits });
  return commits;
}

export function domainContributions(commits: ParsedCommit[], domains: RepoDomain[]): DomainContribution[] {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    if (!commit.email) continue;
    const touched = new Set(commit.files.flatMap((file) => {
      const domain = domainForPath(domains, file);
      return domain ? [domain.id] : [];
    }));
    for (const domainId of touched) {
      const key = `${commit.email}${domainId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([key, commitCount]) => {
    const [author = "", domainId = ""] = key.split("");
    return { author, domainId, commits: commitCount };
  });
}

/**
 * Teams for a repo, paying for churn inference only when the cheap tiers came
 * back empty. Repos with CODEOWNERS never touch the git log here.
 */
export async function resolveTeams(repo: ResolvedOwnedRepo, domains: RepoDomain[]): Promise<RepoTeam[]> {
  const declared = deriveTeams(domains, repo.teams);
  if (!needsChurnInference(declared) || !repo.localPath || domains.length === 0) return declared;
  try {
    const commits = await loadRepoActivity(repo);
    return deriveTeams(domains, repo.teams, domainContributions(commits, domains));
  } catch {
    return declared;
  }
}

/**
 * Familiarity discounts a domain's churn; it must never cancel it.
 *
 * The first version was linear and capped at 1.0, so six reviews scored a
 * domain as fully familiar and `churn × (1 − familiarity)` collapsed to exactly
 * zero. On a real repo that removed the two busiest domains from the ledger
 * altogether — 265 commits of `deployments` scored 0 while a 2-commit dotfile
 * directory ranked third.
 *
 * So: each signal saturates on its own curve, the total is capped below 1, and
 * the strongest evidence (writing the code) is worth more than the weakest
 * (opening the learn pack once). A domain you know well ranks lower. It never
 * disappears.
 */
export const FAMILIARITY_CEILING = 0.7;

export function familiarityScore(authored: number, reviewed: number, learnedAt: string | null): number {
  const authorship = Math.min(0.4, Math.sqrt(Math.max(0, authored)) * 0.14);
  const review = Math.min(0.25, Math.sqrt(Math.max(0, reviewed)) * 0.09);
  const learned = learnedAt ? 0.12 : 0;
  return Math.min(FAMILIARITY_CEILING, authorship + review + learned);
}

async function reviewedDomainCounts(fullName: string, domains: RepoDomain[]): Promise<Map<string, number>> {
  try {
    const { stdout } = await execGh([
      "pr", "list", "--repo", fullName, "--state", "all", "--search", "reviewed-by:@me", "--limit", "50", "--json", "files",
    ]);
    const counts = new Map<string, number>();
    for (const pr of parseJsonArray<{ files?: { path?: string }[] }>(stdout)) {
      const touched = new Set((pr.files ?? []).flatMap((file) => {
        const domain = file.path ? domainForPath(domains, file.path) : null;
        return domain ? [domain.id] : [];
      }));
      for (const id of touched) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  } catch {
    return new Map();
  }
}

export async function loadKnowledgeGaps(
  repo: ResolvedOwnedRepo,
  domains: RepoDomain[],
): Promise<KnowledgeGap[]> {
  if (!repo.localPath || domains.length === 0) return [];
  const [commits, emailResult, reviewed] = await Promise.all([
    loadRepoActivity(repo),
    runGitRepoAsync(repo.localPath, ["config", "--get", "user.email"]),
    reviewedDomainCounts(repo.fullName, domains),
  ]);
  const myEmail = emailResult.stdout.trim().toLowerCase();
  const learned = readLearnedDomains(repo.fullName);
  const churn = new Map<string, number>();
  const commitCounts = new Map<string, number>();
  const authored = new Map<string, number>();
  for (const commit of commits) {
    const ageDays = Math.max(0, (Date.now() - new Date(commit.committedAt).getTime()) / 86_400_000);
    const weight = Math.max(0.1, 1 - ageDays / 100);
    const touched = new Set(commit.files.flatMap((file) => {
      const domain = domainForPath(domains, file);
      return domain ? [domain.id] : [];
    }));
    for (const id of touched) {
      churn.set(id, (churn.get(id) ?? 0) + weight);
      commitCounts.set(id, (commitCounts.get(id) ?? 0) + 1);
      if (myEmail && commit.email === myEmail) authored.set(id, (authored.get(id) ?? 0) + 1);
    }
  }

  return domains.map((domain) => {
    const authoredByMe = authored.get(domain.id) ?? 0;
    const reviewedByMe = reviewed.get(domain.id) ?? 0;
    const learnOpenedAt = learned[domain.id] ?? null;
    const familiarity = familiarityScore(authoredByMe, reviewedByMe, learnOpenedAt);
    const inboundChurn = Number((churn.get(domain.id) ?? 0).toFixed(2));
    return {
      domainId: domain.id,
      label: domain.label,
      inboundChurn,
      familiarity: Number(familiarity.toFixed(2)),
      score: Number((inboundChurn * (1 - familiarity)).toFixed(2)),
      evidence: { commits90d: commitCounts.get(domain.id) ?? 0, authoredByMe, reviewedByMe, learnOpenedAt },
    };
  }).sort((a, b) => b.score - a.score).slice(0, 8);
}

function digestCachePath(repo: ResolvedOwnedRepo, sinceSha: string | null, headSha: string): string {
  const key = createHash("sha256").update(`${repo.fullName}\n${sinceSha ?? "initial"}\n${headSha}`).digest("hex").slice(0, 16);
  return path.join(getNotesDir(), ".cache", "ownership", "digests", `${repo.name}-${key}.json`);
}

export async function loadRepoDigest(
  repo: ResolvedOwnedRepo,
  domains: RepoDomain[],
  options: { generate?: boolean; sinceSha?: string | null; headSha?: string } = {},
): Promise<RepoDigest | null> {
  if (!repo.localPath) return null;
  const defaultRef = repo.defaultBranch ? `refs/remotes/origin/${repo.defaultBranch}` : "HEAD";
  const headResult = options.headSha
    ? { stdout: options.headSha, status: 0 }
    : await runGitRepoAsync(repo.localPath, ["rev-parse", defaultRef]);
  if (headResult.status !== 0) return null;
  const headSha = headResult.stdout.trim();
  let sinceSha = options.sinceSha === undefined ? repo.lastSeenSha : options.sinceSha;
  if (sinceSha && sinceSha !== headSha) {
    const ancestor = await runGitRepoAsync(repo.localPath, ["merge-base", "--is-ancestor", sinceSha, headSha]);
    if (ancestor.status !== 0) sinceSha = null;
  }
  const cachePath = digestCachePath(repo, sinceSha, headSha);
  const cached = safeReadJSON<DigestCache | null>(cachePath, null);
  if (cached?.headSha === headSha && cached.sinceSha === sinceSha) return { ...cached, cached: true };

  const range = sinceSha ? [`${sinceSha}..${headSha}`] : ["--max-count=20", headSha];
  const commits = sinceSha === headSha ? [] : await recentCommits(repo.localPath, ["--first-parent", ...range]);
  const rows = commits.map((commit) => ({
    sha: commit.sha,
    subject: commit.subject,
    committedAt: commit.committedAt,
    domains: [...new Set(commit.files.flatMap((file) => {
      const domain = domainForPath(domains, file);
      return domain ? [domain.label] : [];
    }))],
    domainIds: [...new Set(commit.files.flatMap((file) => {
      const domain = domainForPath(domains, file);
      return domain ? [domain.id] : [];
    }))],
  }));
  const model = getNotesAiModel();
  let summaryMarkdown: string | null = null;
  if (options.generate && model && rows.length) {
    const result = await generateText({
      model,
      prompt: [
        `Summarize changes in ${repo.fullName} since the owner last looked.`,
        "Group by domain. Use only the commit evidence below. Be concise and name risks or follow-up questions, not generic praise.",
        JSON.stringify(rows.slice(0, 80), null, 2),
      ].join("\n\n"),
      ...getNotesAiCallOptions(),
    });
    summaryMarkdown = result.text.trim() || null;
  }
  const digest: DigestCache = {
    fullName: repo.fullName,
    sinceSha,
    headSha,
    generatedAt: summaryMarkdown ? new Date().toISOString() : null,
    cached: false,
    aiConfigured: Boolean(model),
    summaryMarkdown,
    commits: rows,
  };
  if (summaryMarkdown) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    await writeAtomic(cachePath, JSON.stringify(digest, null, 2) + "\n");
  }
  return digest;
}

/**
 * Upper bound on paths fed to `git log`. Large refactors and grouped dependency
 * bumps blow past any small limit, and rejecting those PRs outright is worse
 * than analysing the first N files — so we truncate and say so.
 */
export const MAX_BLAST_PATHS = 300;

export async function loadBlastRadius(repo: ResolvedOwnedRepo, requestedPaths: string[]) {
  const paths = requestedPaths.slice(0, MAX_BLAST_PATHS);
  const truncated = requestedPaths.length > paths.length;
  if (!repo.localPath) {
    return {
      domains: [],
      companions: [],
      reviewers: [],
      commitsAnalysed: 0,
      analysedPaths: 0,
      truncated: false,
      unavailable: "Clone this repo locally to calculate blast radius.",
    };
  }
  return {
    ...await analyzeChangeImpact(repo.localPath, repo.fullName, paths, repo.domains),
    analysedPaths: paths.length,
    truncated,
    unavailable: null as string | null,
  };
}

export interface BriefOptions {
  /** Skip the 90-day log + review search. The page fetches gaps separately. */
  includeGaps?: boolean;
  /** Skip catch-up history. The page fetches the digest separately. */
  includeDigest?: boolean;
}

export async function loadOwnerBriefForRepo(
  repo: ResolvedOwnedRepo,
  options: BriefOptions = {},
): Promise<OwnerBrief> {
  const { includeGaps = true, includeDigest = true } = options;
  const warnings: string[] = [];
  const domains = repo.localPath ? await deriveDomains(repo.localPath, repo.domains) : [];
  const teams = await resolveTeams(repo, domains);
  if (!repo.localPath) warnings.push("Clone this repo to unlock domains, blast radius, gaps, and catch-up history.");

  let prs: RepoPrRadarRow[] = [];
  try {
    prs = await loadPrRadar(repo, { domains, teams });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Could not load GitHub pull requests.");
  }
  const [obligations, gaps, digest] = await Promise.all([
    loadObligations(repo, prs),
    includeGaps ? loadKnowledgeGaps(repo, domains) : Promise.resolve([]),
    includeDigest ? loadRepoDigest(repo, domains) : Promise.resolve(null),
  ]);
  return { repo, domains, teams, prs, obligations, gaps, digest, warnings };
}

export async function loadOwnerBrief(fullName: string, options: BriefOptions = {}): Promise<OwnerBrief> {
  const repo = await resolveOwnedRepo(fullName);
  if (!repo) throw new OwnedRepoNotFoundError(fullName);
  return loadOwnerBriefForRepo(repo, options);
}

export interface OwnershipSummaryRow {
  repo: ResolvedOwnedRepo;
  obligations: RepoObligations;
  openPrs: number;
  attention: AttentionSummary;
  error: string | null;
  warning?: string | null;
}

let summaryCache: { expiresAt: number; value: Promise<OwnershipSummaryRow[]> } | null = null;

export function invalidateOwnershipSummary(): void {
  summaryCache = null;
}

/**
 * The `/own` index, deliberately cheaper than a brief per repo.
 *
 * The index only renders obligations and a headline count, so it skips the two
 * expensive panels entirely. Gaps alone were most of a brief's cost, and paying
 * for them once per owned repo made the index scale badly with the number of
 * repos you own.
 */
export async function loadOwnershipSummary(): Promise<OwnershipSummaryRow[]> {
  if (summaryCache && summaryCache.expiresAt > Date.now()) return summaryCache.value;
  const value = loadOwnershipSummaryUncached().catch((error: unknown) => {
    summaryCache = null;
    throw error;
  });
  summaryCache = { expiresAt: Date.now() + 60_000, value };
  return value;
}

async function loadOwnershipSummaryUncached(): Promise<OwnershipSummaryRow[]> {
  const repos = await resolveOwnedRepos();
  return pMap(repos, 3, async (repo) => {
    let prs: RepoPrRadarRow[] = [];
    let warning: string | null = null;
    try {
      prs = await loadPrRadar(repo);
    } catch (error) {
      warning = error instanceof Error ? error.message : "Could not load pull requests.";
    }
    try {
      const obligations = await loadObligations(repo, prs);
      return {
        repo,
        obligations,
        openPrs: prs.length,
        attention: attentionSummary(obligations, prs),
        error: null,
        warning,
      };
    } catch (error) {
      const obligations: RepoObligations = {
        defaultBranchCi: "unknown",
        staleBranches: [],
        botPrs: 0,
        unassignedIssues: null,
        partial: true,
      };
      return {
        repo,
        obligations,
        openPrs: 0,
        attention: { score: 0, reasons: [] },
        error: error instanceof Error ? error.message : "Could not load this repository.",
      };
    }
  });
}
