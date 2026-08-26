/**
 * Daily rep generation — picks real practice material from the user's owned
 * repos and vault, deterministically seeded by date + attempt so a reload
 * never reshuffles the day's rep.
 *
 * Kinds, in descending weight:
 * - cold-read: a recent commit someone else wrote, message hidden. Reading
 *   unfamiliar code cold is the muscle AI assistance erodes fastest.
 * - gap-sketch: the top knowledge gap in an owned repo (from the ownership
 *   gap ledger) — sketch the domain from memory.
 * - recall: redraw one of your own diagrams from memory.
 *
 * Deliberately absent: anything resembling a PR review — the day job already
 * provides those reps.
 */

import { getDiagramIndex } from "@/lib/diagrams/diagram-index";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { deriveDomains } from "@/lib/ownership/domains";
import { resolveOwnedRepos } from "@/lib/ownership/owned-repos";
import { loadKnowledgeGaps } from "@/lib/ownership/service";
import type { ResolvedOwnedRepo } from "@/lib/ownership/types";
import type { GeneratedRep, Rep, RepKind } from "@/lib/reps-shared";

export interface CommitCandidate {
  repo: string;
  sha: string;
  committedAt: string;
  email: string;
  author: string;
  subject: string;
  additions: number;
  deletions: number;
  files: string[];
}

/** FNV-1a 32-bit — stable across processes, unlike anything Math.random. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function pickBySeed<T>(items: T[], seed: number): T | null {
  if (items.length === 0) return null;
  return items[seed % items.length];
}

/** Weighted preference; cold reads are the sharpest practice, so most days. */
const KIND_WEIGHTS: [RepKind, number][] = [
  ["cold-read", 4],
  ["gap-sketch", 2],
  ["recall", 1],
];

export function chooseRepKind(seed: number, available: RepKind[]): RepKind | null {
  const pool = KIND_WEIGHTS.flatMap(([kind, weight]) =>
    available.includes(kind) ? Array<RepKind>(weight).fill(kind) : [],
  );
  return pickBySeed(pool, seed);
}

/** Chosen kind first, remaining kinds as fallbacks in weight order. */
export function kindOrder(seed: number): RepKind[] {
  const all = KIND_WEIGHTS.map(([kind]) => kind);
  const chosen = chooseRepKind(seed, all) ?? all[0];
  return [chosen, ...all.filter((kind) => kind !== chosen)];
}

/** Lockfiles, snapshots, and build output make for miserable cold reads. */
const GENERATED_FILE_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum)$|\.(snap|min\.js|min\.css|map)$|(^|\/)(dist|build|vendor|node_modules|__snapshots__)\//;

const MIN_CHANGED_LINES = 10;
const MAX_CHANGED_LINES = 800;

/** Deploy runners, dependabots, provisioners — nothing worth reading cold. */
const BOT_AUTHOR_RE = /\[bot\]|\bbot\b|github.actions|dependabot|renovate|fluxcd|deploy|provision|automation/i;

export function isColdReadCandidate(candidate: CommitCandidate, myEmail: string): boolean {
  if (myEmail && candidate.email === myEmail) return false;
  if (BOT_AUTHOR_RE.test(`${candidate.author} ${candidate.email}`)) return false;
  if (/^(Merge|Revert)\b/i.test(candidate.subject)) return false;
  const total = candidate.additions + candidate.deletions;
  if (total < MIN_CHANGED_LINES || total > MAX_CHANGED_LINES) return false;
  return candidate.files.some((file) => !GENERATED_FILE_RE.test(file));
}

/**
 * Parse `git log --format=%x1e%H%x00%aI%x00%ae%x00%an%x00%s --numstat` output.
 * Numstat lines are `added<TAB>deleted<TAB>path` with `-` for binary files.
 */
export function parseNumstatLog(repo: string, stdout: string): CommitCandidate[] {
  const commits: CommitCandidate[] = [];
  let current: CommitCandidate | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("\u001e")) {
      if (current) commits.push(current);
      const [sha = "", committedAt = "", email = "", author = "", subject = ""] = line.slice(1).split("\0");
      current = {
        repo,
        sha,
        committedAt,
        email: email.toLowerCase(),
        author,
        subject,
        additions: 0,
        deletions: 0,
        files: [],
      };
      continue;
    }
    if (!current) continue;
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match) continue;
    current.additions += match[1] === "-" ? 0 : Number(match[1]);
    current.deletions += match[2] === "-" ? 0 : Number(match[2]);
    current.files.push(match[3]);
  }
  if (current) commits.push(current);
  return commits;
}

/** The key a swap excludes so regenerating never hands back the same material. */
export function repExcludeKey(rep: Pick<Rep, "material">): string {
  const material = rep.material;
  if (material.kind === "cold-read") return `cold-read:${material.sha}`;
  if (material.kind === "gap-sketch") return `gap-sketch:${material.repo}:${material.domainId}`;
  return `recall:${material.diagramPath}`;
}

const GIT_TIMEOUT_MS = 30_000;
const COLD_READ_WINDOW = "14 days ago";

async function coldReadCandidates(repos: ResolvedOwnedRepo[]): Promise<CommitCandidate[]> {
  const results = await Promise.all(
    repos.flatMap((repo) => {
      const localPath = repo.localPath;
      if (!localPath) return [];
      return [
        (async () => {
          const [log, email] = await Promise.all([
            runGitRepoAsync(
              localPath,
              [
                "log", "--all", "--no-merges", `--since=${COLD_READ_WINDOW}`,
                "--format=%x1e%H%x00%aI%x00%ae%x00%an%x00%s", "--numstat",
              ],
              { timeout: GIT_TIMEOUT_MS },
            ),
            runGitRepoAsync(localPath, ["config", "--get", "user.email"]),
          ]);
          if (log.status !== 0) return [];
          const myEmail = email.stdout.trim().toLowerCase();
          return parseNumstatLog(repo.fullName, log.stdout).filter((candidate) =>
            isColdReadCandidate(candidate, myEmail),
          );
        })(),
      ];
    }),
  );
  return results.flat();
}

async function buildColdRead(
  repos: ResolvedOwnedRepo[],
  seed: number,
  excludeKey?: string,
): Promise<GeneratedRep | null> {
  const candidates = (await coldReadCandidates(repos)).filter(
    (candidate) => `cold-read:${candidate.sha}` !== excludeKey,
  );
  const pick = pickBySeed(candidates, seed);
  if (!pick) return null;
  const repo = repos.find((r) => r.fullName === pick.repo);
  if (!repo?.localPath) return null;
  const message = await runGitRepoAsync(repo.localPath, [
    "log", "-1", "--format=%s%x00%b%x00%an", pick.sha,
  ]);
  const [subject = pick.subject, body = "", author = ""] =
    message.status === 0 ? message.stdout.split("\0") : [];
  return {
    kind: "cold-read",
    material: {
      kind: "cold-read",
      repo: pick.repo,
      sha: pick.sha,
      committedAt: pick.committedAt,
      filesChanged: pick.files.length,
      additions: pick.additions,
      deletions: pick.deletions,
    },
    reveal: {
      kind: "cold-read",
      subject: subject.trim(),
      body: body.trim(),
      author: author.trim(),
      url: `https://github.com/${pick.repo}/commit/${pick.sha}`,
    },
  };
}

async function buildGapSketch(
  repos: ResolvedOwnedRepo[],
  seed: number,
  excludeKey?: string,
): Promise<GeneratedRep | null> {
  const local = repos.filter((repo) => repo.localPath);
  const repo = pickBySeed(local, seed);
  if (!repo?.localPath) return null;
  const domains = await deriveDomains(repo.localPath, repo.domains);
  const gaps = (await loadKnowledgeGaps(repo, domains)).filter(
    (gap) =>
      gap.score > 0 &&
      gap.evidence.commits90d > 0 &&
      `gap-sketch:${repo.fullName}:${gap.domainId}` !== excludeKey,
  );
  // Top-ranked gap, not a seeded pick — the point is the biggest gap.
  const gap = gaps[0];
  if (!gap) return null;
  const paths = domains.find((domain) => domain.id === gap.domainId)?.paths ?? [];
  const log = await runGitRepoAsync(
    repo.localPath,
    ["log", "--all", "--since=90 days ago", "--format=%an%x00%s", "--", ...(paths.length ? paths : ["."])],
    { timeout: GIT_TIMEOUT_MS },
  );
  // Bot commits (release trains, deploy runners) drown out the human story.
  const humanSubjects = log.status === 0
    ? log.stdout.split("\n").flatMap((line) => {
        const [author = "", subject = ""] = line.split("\0");
        return subject.trim() && !BOT_AUTHOR_RE.test(author) ? [subject.trim()] : [];
      })
    : [];
  const recentSubjects = [...new Set(humanSubjects)].slice(0, 12);
  return {
    kind: "gap-sketch",
    material: {
      kind: "gap-sketch",
      repo: repo.fullName,
      domainId: gap.domainId,
      label: gap.label,
      paths,
      commits90d: gap.evidence.commits90d,
      authoredByMe: gap.evidence.authoredByMe,
    },
    reveal: {
      kind: "gap-sketch",
      recentSubjects,
      learnHref: `/repos/learn/${encodeURIComponent(repo.localRepoName ?? repo.name)}`,
    },
  };
}

function buildRecall(seed: number, excludeKey?: string): GeneratedRep | null {
  const diagrams = getDiagramIndex().diagrams.filter(
    (diagram) => `recall:${diagram.path}` !== excludeKey,
  );
  const pick = pickBySeed(diagrams, seed);
  if (!pick) return null;
  return {
    kind: "recall",
    material: { kind: "recall", title: pick.name, diagramPath: pick.path },
    reveal: { kind: "recall", href: pick.href },
  };
}

/**
 * Generate the day's rep. The seeded kind is tried first; when its material
 * doesn't exist (no foreign commits this week, no gaps, no diagrams) the
 * remaining kinds are fallbacks. Returns null only when there is no material
 * anywhere.
 */
export async function generateRep(
  date: string,
  attempt: number,
  excludeKey?: string,
): Promise<GeneratedRep | null> {
  const seed = hashSeed(`${date}#${attempt}`);
  const repos = await resolveOwnedRepos();
  for (const kind of kindOrder(seed)) {
    const rep =
      kind === "cold-read"
        ? await buildColdRead(repos, seed, excludeKey)
        : kind === "gap-sketch"
          ? await buildGapSketch(repos, seed, excludeKey)
          : buildRecall(seed, excludeKey);
    if (rep) return rep;
  }
  return null;
}
