/**
 * Capability Radar — scan orchestration.
 *
 * Enumerates repos (local clones first, then optionally un-cloned GitHub repos),
 * runs the appropriate scanner on each, rolls the results into a dated snapshot,
 * persists it, and diffs it against the previous snapshot.
 */

import { listRepos, listAccessibleGithubRepos } from "@/lib/repos";
import { isGithubCliAuthenticated } from "@/lib/gh-exec";
import { buildSnapshot } from "./aggregate";
import { diffSnapshots } from "./diff";
import { probeGithubRepo } from "./github-probe";
import { scanLocalRepo } from "./local-scan";
import {
  readPreviousSnapshot,
  writeRepoScanCache,
  writeSnapshot,
} from "./snapshots";
import type { CapabilityDiff, CapabilitySnapshot, RepoScan } from "./types";

export interface ScanOptions {
  /** Also probe accessible GitHub repos that aren't cloned locally. */
  includeGithub?: boolean;
  /** Max un-cloned GitHub repos to probe in one run (rate-limit guard). */
  githubLimit?: number;
  /** Restrict remote scan to repos whose full name contains this (owner/org). */
  githubFilter?: string;
}

const DEFAULT_GITHUB_LIMIT = 40;

export interface ScanResult {
  snapshot: CapabilitySnapshot;
  diff: CapabilityDiff;
  warnings: string[];
}

export async function runScan(opts: ScanOptions = {}): Promise<ScanResult> {
  const warnings: string[] = [];
  const scans: RepoScan[] = [];
  const scannedLocalNames = new Set<string>();

  // 1. Local clones — full scans (best signal, zero API cost).
  const local = await listRepos();
  const localResults = await Promise.allSettled(local.map((r) => scanLocalRepo(r.path)));
  localResults.forEach((res, i) => {
    if (res.status === "fulfilled") {
      scans.push(res.value);
      scannedLocalNames.add(local[i].name);
    } else {
      warnings.push(`local scan failed for ${local[i].name}: ${String(res.reason).slice(0, 120)}`);
    }
  });

  // 2. Un-cloned GitHub repos — adaptive remote probe.
  if (opts.includeGithub) {
    const authed = await isGithubCliAuthenticated();
    if (!authed) {
      warnings.push("GitHub CLI not authenticated — skipped remote scan (local-only).");
    } else {
      try {
        const filter = opts.githubFilter?.toLowerCase();
        const limit = opts.githubLimit ?? DEFAULT_GITHUB_LIMIT;
        const remote = (await listAccessibleGithubRepos())
          .filter((r) => !r.localRepoName) // not already scanned locally
          .filter((r) => (filter ? r.fullName.toLowerCase().includes(filter) : true))
          .slice(0, limit);

        const probed = await Promise.allSettled(
          remote.map((r) =>
            probeGithubRepo({
              fullName: r.fullName,
              repoName: r.name,
              defaultBranch: r.defaultBranch ?? "main",
            }),
          ),
        );
        probed.forEach((res, i) => {
          if (res.status === "fulfilled" && res.value) {
            scans.push(res.value);
          } else if (res.status === "rejected") {
            warnings.push(`remote probe failed for ${remote[i].fullName}: ${String(res.reason).slice(0, 120)}`);
          }
        });
        if (remote.length === limit) {
          warnings.push(`Remote scan capped at ${limit} repos. Narrow with a filter or raise the limit.`);
        }
      } catch (err) {
        warnings.push(`remote enumeration failed: ${String(err).slice(0, 160)}`);
      }
    }
  }

  // 3. Persist per-repo caches (enables adaptive skip next run).
  await Promise.all(
    scans.map((scan) =>
      writeRepoScanCache({
        repoName: scan.repoName,
        sha: scan.sha,
        scannedAt: scan.scannedAt,
        scan,
      }),
    ),
  );

  // 4. Roll up, persist snapshot, diff against previous.
  const snapshot = buildSnapshot(scans);
  await writeSnapshot(snapshot);
  const previous = readPreviousSnapshot(snapshot.id);
  const diff = diffSnapshots(snapshot, previous);

  return { snapshot, diff, warnings };
}
