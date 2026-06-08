import type { ManagedKind } from "./managed-catalog-kind";

export interface ManagedCatalogLoadingFlags {
  loadingSkills: boolean;
  loadingAgents: boolean;
  loadingLocal: boolean;
  refreshingSkills: boolean;
}

/** True while the skills/agents catalog list should show a skeleton (not stale rows). */
export function managedCatalogListLoading(
  kind: ManagedKind,
  flags: ManagedCatalogLoadingFlags,
): boolean {
  if (kind === "skill") {
    return flags.loadingSkills || flags.loadingLocal || flags.refreshingSkills;
  }
  return flags.loadingAgents || flags.loadingLocal;
}
