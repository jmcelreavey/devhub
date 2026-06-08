import fs from "node:fs";
import { agentCatalogContentEqual } from "./agent-sync-format";
import type { LocalCatalogStatus, LocalSkillSource } from "./local-skills-types";
import { newestMeaningfulMtimeMs, treesEqual } from "./tree-compare";

export function newestLocalSource(sources: LocalSkillSource[]): LocalSkillSource | undefined {
  return [...sources].sort((a, b) => (b.latestMtimeMs ?? 0) - (a.latestMtimeMs ?? 0))[0];
}

export function classifyLocalCatalogRecord(sourcePath: string, repoPath: string): {
  status: LocalCatalogStatus;
  repoMtimeMs: number | null;
  localMtimeMs: number | null;
} {
  const localMtimeMs = newestMeaningfulMtimeMs(sourcePath);
  if (!fs.existsSync(repoPath)) return { status: "new", repoMtimeMs: null, localMtimeMs };
  const repoMtimeMs = newestMeaningfulMtimeMs(repoPath);
  if (treesEqual(sourcePath, repoPath)) return { status: "in-sync", repoMtimeMs, localMtimeMs };
  if (localMtimeMs != null && repoMtimeMs != null) {
    if (localMtimeMs > repoMtimeMs) return { status: "local-newer", repoMtimeMs, localMtimeMs };
    if (repoMtimeMs > localMtimeMs) return { status: "repo-newer", repoMtimeMs, localMtimeMs };
  }
  return { status: "changed", repoMtimeMs, localMtimeMs };
}

/** Classify a local agent file against agents/shared; content-aware (synced copies differ in frontmatter). */
export function classifyLocalAgentRecord(sourcePath: string, repoPath: string): {
  status: LocalCatalogStatus;
  repoMtimeMs: number | null;
  localMtimeMs: number | null;
} {
  const localMtimeMs = newestMeaningfulMtimeMs(sourcePath);
  if (!fs.existsSync(repoPath)) return { status: "new", repoMtimeMs: null, localMtimeMs };
  const repoMtimeMs = newestMeaningfulMtimeMs(repoPath);
  if (agentCatalogContentEqual(sourcePath, repoPath)) {
    return { status: "in-sync", repoMtimeMs, localMtimeMs };
  }
  if (localMtimeMs != null && repoMtimeMs != null) {
    if (localMtimeMs > repoMtimeMs) return { status: "local-newer", repoMtimeMs, localMtimeMs };
    if (repoMtimeMs > localMtimeMs) return { status: "repo-newer", repoMtimeMs, localMtimeMs };
  }
  return { status: "changed", repoMtimeMs, localMtimeMs };
}
