import fs from "node:fs";
import path from "node:path";
import { execGh } from "@/lib/gh-exec";
import { getReposScanDir, getGithubFullNameForLocalRepo } from "@/lib/repos";
import { loadRepoPeople } from "@/lib/people/repo-people";
import { getGithubLogin } from "@/lib/standup/github-merged";
import type { GithubPrAuthor, GithubPrRow } from "@/lib/github/prs";

/** GitHub login: 1–39 chars, alphanumeric or hyphen, no leading/trailing hyphen. */
export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_SUGGESTIONS = 12;

export interface OwnerRepo {
  owner: string;
  name: string;
}

export interface PrReviewerContext {
  requested: GithubPrAuthor[];
  suggested: GithubPrAuthor[];
}

interface GraphqlUser {
  login?: string;
  avatarUrl?: string;
}

interface ReviewRequestNode {
  requestedReviewer?: GraphqlUser | null;
}

interface ViewerPullRequestsResponse {
  data?: {
    viewer?: {
      pullRequests?: {
        nodes?: Array<{
          url?: string;
          reviewRequests?: { nodes?: ReviewRequestNode[] };
        }>;
      };
    };
  };
}

interface PrReviewerGraphqlResponse {
  data?: {
    repository?: {
      pullRequest?: {
        suggestedReviewers?: Array<{ reviewer?: GraphqlUser | null } | null>;
        reviewRequests?: { nodes?: ReviewRequestNode[] };
      };
    };
  };
}

interface RequestedReviewersRestResponse {
  requested_reviewers?: Array<{ login?: string; avatar_url?: string }>;
  users?: Array<{ login?: string; avatar_url?: string }>;
}

export function parseOwnerRepo(repo: string): OwnerRepo | null {
  const trimmed = repo.trim();
  if (!REPO_FULL_NAME_RE.test(trimmed)) return null;
  const slash = trimmed.indexOf("/");
  const owner = trimmed.slice(0, slash);
  const name = trimmed.slice(slash + 1);
  if (!owner || !name) return null;
  return { owner, name };
}

/** Split, validate, and case-insensitively dedupe GitHub logins. */
export function parseGithubLogins(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((value) =>
    value.split(/[,\s]+/),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const login = part.trim();
    if (!GITHUB_LOGIN_RE.test(login)) continue;
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(login);
  }
  return out;
}

export function usersFromReviewRequestNodes(
  nodes: ReviewRequestNode[] | undefined,
): GithubPrAuthor[] {
  const seen = new Set<string>();
  const out: GithubPrAuthor[] = [];
  for (const node of nodes ?? []) {
    const author = userFromGraphql(node.requestedReviewer);
    if (!author) continue;
    const key = author.login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(author);
  }
  return out;
}

export function usersFromRestReviewers(
  body: RequestedReviewersRestResponse,
): GithubPrAuthor[] {
  const rows = body.requested_reviewers ?? body.users ?? [];
  const seen = new Set<string>();
  const out: GithubPrAuthor[] = [];
  for (const row of rows) {
    const login = row.login?.trim();
    if (!login) continue;
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const avatarUrl = row.avatar_url?.trim();
    out.push(avatarUrl ? { login, avatarUrl } : { login });
  }
  return out;
}

export function buildRequestReviewersArgs(
  repo: string,
  number: number,
  reviewers: string[],
): string[] {
  const parsed = parseOwnerRepo(repo);
  if (!parsed) throw new Error("Expected owner/name");
  if (reviewers.length === 0) throw new Error("At least one reviewer is required");
  return [
    "api",
    "--method",
    "POST",
    `repos/${parsed.owner}/${parsed.name}/pulls/${number}/requested_reviewers`,
    ...reviewers.flatMap((login) => ["-f", `reviewers[]=${login}`]),
  ];
}

export async function requestPrReviewers(opts: {
  repo: string;
  number: number;
  reviewers: string[];
}): Promise<GithubPrAuthor[]> {
  const logins = parseGithubLogins(opts.reviewers);
  if (logins.length === 0) {
    throw new Error("Enter at least one valid GitHub username.");
  }
  const { stdout } = await execGh(
    buildRequestReviewersArgs(opts.repo, opts.number, logins),
  );
  const parsed = JSON.parse(stdout) as RequestedReviewersRestResponse;
  return usersFromRestReviewers(parsed);
}

export async function attachRequestedReviewers(
  rows: GithubPrRow[],
): Promise<GithubPrRow[]> {
  if (rows.length === 0) return rows;
  const byUrl = await fetchViewerReviewRequestsByUrl();
  if (!byUrl) return rows;
  return rows.map((row) => {
    const requested = byUrl.get(row.url);
    return requested ? { ...row, requestedReviewers: requested } : row;
  });
}

export async function fetchPrReviewerContext(opts: {
  repo: string;
  number: number;
}): Promise<PrReviewerContext> {
  const parsed = parseOwnerRepo(opts.repo);
  if (!parsed) throw new Error("Expected owner/name");

  const [graphql, selfLogin] = await Promise.all([
    fetchPrReviewerGraphql(parsed, opts.number),
    getGithubLogin(),
  ]);

  const requested = graphql?.requested ?? [];
  const exclude = new Set(
    [
      ...requested.map((user) => user.login),
      selfLogin,
    ]
      .filter((login): login is string => Boolean(login))
      .map((login) => login.toLowerCase()),
  );

  const suggested = dedupeAuthors([
    ...(graphql?.suggested ?? []),
    ...(await suggestedFromLocalPeople(opts.repo, exclude)),
  ], exclude).slice(0, MAX_SUGGESTIONS);

  return { requested, suggested };
}

function userFromGraphql(user: GraphqlUser | null | undefined): GithubPrAuthor | null {
  const login = user?.login?.trim();
  if (!login) return null;
  const avatarUrl = user?.avatarUrl?.trim();
  return avatarUrl ? { login, avatarUrl } : { login };
}

function dedupeAuthors(authors: GithubPrAuthor[], exclude: Set<string>): GithubPrAuthor[] {
  const seen = new Set(exclude);
  const out: GithubPrAuthor[] = [];
  for (const author of authors) {
    const key = author.login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(author);
  }
  return out;
}

async function fetchViewerReviewRequestsByUrl(): Promise<Map<string, GithubPrAuthor[]> | null> {
  const query =
    "query { viewer { pullRequests(first: 30, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { url reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login avatarUrl } } } } } } } }";
  try {
    const { stdout } = await execGh(["api", "graphql", "-f", `query=${query}`]);
    const body = JSON.parse(stdout) as ViewerPullRequestsResponse;
    const nodes = body.data?.viewer?.pullRequests?.nodes ?? [];
    const byUrl = new Map<string, GithubPrAuthor[]>();
    for (const node of nodes) {
      const url = node.url?.trim();
      if (!url) continue;
      byUrl.set(url, usersFromReviewRequestNodes(node.reviewRequests?.nodes));
    }
    return byUrl;
  } catch {
    return null;
  }
}

async function fetchPrReviewerGraphql(
  repo: OwnerRepo,
  number: number,
): Promise<PrReviewerContext | null> {
  const query =
    "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { suggestedReviewers { reviewer { login avatarUrl } } reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login avatarUrl } } } } } } }";
  try {
    const { stdout } = await execGh([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${repo.owner}`,
      "-f",
      `name=${repo.name}`,
      "-F",
      `number=${number}`,
    ]);
    const body = JSON.parse(stdout) as PrReviewerGraphqlResponse;
    const pr = body.data?.repository?.pullRequest;
    if (!pr) return null;
    const requested = usersFromReviewRequestNodes(pr.reviewRequests?.nodes);
    const suggested: GithubPrAuthor[] = [];
    for (const row of pr.suggestedReviewers ?? []) {
      const author = userFromGraphql(row?.reviewer);
      if (author) suggested.push(author);
    }
    return { requested, suggested };
  } catch {
    return null;
  }
}

async function suggestedFromLocalPeople(
  repoFullName: string,
  exclude: Set<string>,
): Promise<GithubPrAuthor[]> {
  const repoPath = findLocalClonePath(repoFullName);
  if (!repoPath) return [];
  try {
    const { people } = await loadRepoPeople(repoPath);
    const out: GithubPrAuthor[] = [];
    for (const person of people) {
      const login = person.githubLogin?.trim();
      if (!login || exclude.has(login.toLowerCase())) continue;
      out.push(person.avatarUrl ? { login, avatarUrl: person.avatarUrl } : { login });
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

function findLocalClonePath(repoFullName: string): string | null {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return null;
  const wanted = repoFullName.toLowerCase();
  try {
    for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(scanDir, entry.name);
      const fullName = getGithubFullNameForLocalRepo(repoPath);
      if (fullName?.toLowerCase() === wanted) return repoPath;
    }
  } catch {
    return null;
  }
  return null;
}
