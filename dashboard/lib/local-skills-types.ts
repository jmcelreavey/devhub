/** Shared types for local skill discovery (safe to import from client components). */

export interface LocalSkillSource {
  tool: string;
  absPath: string;
  kind: "skill" | "agent";
  latestMtimeMs: number | null;
}

export type LocalCatalogStatus = "new" | "local-newer" | "repo-newer" | "changed" | "in-sync";

export function canImportLocalCandidate(candidate: Pick<LocalSkillImportCandidate, "status">): boolean {
  return candidate.status === "new" || candidate.status === "local-newer" || candidate.status === "changed";
}

export function localCatalogStatusLabel(status: LocalCatalogStatus): string {
  switch (status) {
    case "new":
      return "new locally";
    case "local-newer":
      return "local newer";
    case "repo-newer":
      return "catalog newer";
    case "changed":
      return "diverged";
    case "in-sync":
      return "in sync";
  }
}

export interface LocalSkillImportCandidate {
  name: string;
  kind: "skill" | "agent";
  sources: LocalSkillSource[];
  alreadyInRepo: boolean;
  status: LocalCatalogStatus;
  repoPath?: string;
  repoMtimeMs: number | null;
  localMtimeMs: number | null;
  /** Auto "Collect all" skips these; explicit import from UI still allowed. */
  excludedFromAutoCollect: boolean;
}
