/**
 * Capability Radar — remote (un-cloned) GitHub prober, with adaptive depth.
 *
 * Depth is chosen by *what we're doing*, per the design decision:
 *   - first time seeing a repo  → DEEP   (tree + generous content probes: catch concepts)
 *   - SHA changed since last run → MID    (tree + a few content probes: catch what moved)
 *   - SHA unchanged             → CACHED  (reuse last scan: ~1 API call)
 *
 * Filename rules run on the git tree for free (one API call). Only content
 * rules — the concept/GitOps signals that need to read `kind:` etc. — spend the
 * content-fetch budget. Everything degrades gracefully to filename-only.
 */

import { execGh } from "@/lib/gh-exec";
import { enrichSignalsWithAi } from "./ai-enrich";
import { detectSignals, isContentCandidate, type ScanFile } from "./detectors";
import { readRepoScanCache, type RepoScanCache } from "./snapshots";
import type { RepoScan } from "./types";

const DEEP_CONTENT = 30;
const MID_CONTENT = 12;

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

function extAndBase(p: string): { ext: string; base: string } {
  const base = (p.split("/").pop() ?? p).toLowerCase();
  const dot = base.lastIndexOf(".");
  return { ext: dot > 0 ? base.slice(dot) : "", base };
}

async function branchSha(fullName: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execGh([
      "api",
      `repos/${fullName}/branches/${encodeURIComponent(branch)}`,
      "--jq",
      ".commit.sha",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function fetchTree(fullName: string, sha: string): Promise<TreeEntry[]> {
  try {
    const { stdout } = await execGh([
      "api",
      `repos/${fullName}/git/trees/${sha}?recursive=1`,
      "--jq",
      ".tree[] | {path: .path, type: .type, size: .size}",
    ]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TreeEntry);
  } catch {
    return [];
  }
}

async function fetchContent(fullName: string, path: string, sha: string): Promise<string | null> {
  try {
    const { stdout } = await execGh([
      "api",
      `repos/${fullName}/contents/${path}?ref=${sha}`,
      "--jq",
      "select(.encoding == \"base64\") | .content",
    ]);
    const b64 = stdout.replace(/\s+/g, "");
    if (!b64) return null;
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/** Score a path for content-probe priority: infra/manifest YAML and TF first. */
function contentScore(p: string): number {
  const { ext, base } = extAndBase(p);
  if (!isContentCandidate(ext)) return -1;
  let s = 0;
  if (base === "package.json") s += 5;
  if (ext === ".yaml" || ext === ".yml") s += 3;
  if (ext === ".tf") s += 3;
  if (/(cluster|deploy|k8s|kube|manifest|infra|flux|helm|release|gitops|argo)/i.test(p)) s += 4;
  if (/(release|kustomization|composition|externalsecret|serviceaccount|values)/i.test(base)) s += 2;
  return s;
}

export interface ProbeOptions {
  fullName: string;
  repoName: string;
  defaultBranch: string;
}

/**
 * Probe a remote repo. Returns null only if we can't even resolve a SHA (e.g.
 * auth/rate-limit failure with no cache to fall back on).
 */
export async function probeGithubRepo(opts: ProbeOptions): Promise<RepoScan | null> {
  const { fullName, repoName, defaultBranch } = opts;
  const sha = await branchSha(fullName, defaultBranch);
  const cache = readRepoScanCache(repoName);

  // Unchanged since last scan → reuse (cheapest path).
  if (sha && cache?.sha === sha && cache.scan.source === "github") {
    return { ...cache.scan, depth: "cached", scannedAt: new Date().toISOString() };
  }

  if (!sha) {
    // Couldn't resolve SHA; surface stale cache if we have one, else give up.
    return cache?.scan ?? null;
  }

  const firstSeen = !cache;
  const budget = firstSeen ? DEEP_CONTENT : MID_CONTENT;

  const tree = await fetchTree(fullName, sha);
  const blobs = tree.filter((e) => e.type === "blob");

  // Content candidates, highest priority first, within budget.
  const candidates = blobs
    .map((e) => ({ path: e.path, score: contentScore(e.path), size: e.size ?? 0 }))
    .filter((c) => c.score >= 0 && c.size <= 96 * 1024)
    .sort((a, b) => b.score - a.score)
    .slice(0, budget);

  const contentMap = new Map<string, string>();
  await Promise.all(
    candidates.map(async (c) => {
      const text = await fetchContent(fullName, c.path, sha);
      if (text) contentMap.set(c.path, text);
    }),
  );

  const files: ScanFile[] = blobs.map((e) => {
    const { ext, base } = extAndBase(e.path);
    return { path: e.path, ext, base, content: contentMap.get(e.path) };
  });

  const signals = await enrichSignalsWithAi(files, detectSignals(files));

  return {
    repoName,
    repoRef: `github:${fullName}`,
    source: "github",
    sha,
    depth: firstSeen ? "full" : "tree",
    scannedAt: new Date().toISOString(),
    signals,
    // Remote repos: no local git history, so no personal-exposure signal.
    lastTouchedByMe: {},
  };
}

export type { RepoScanCache };
