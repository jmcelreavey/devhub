import type { SyncPreviewResult } from "./sync-preview-types";

/** Unique skill/agent names that prune would remove from tool dirs. */
export function uniquePruneNames(preview: SyncPreviewResult): string[] {
  const names = new Set<string>();
  for (const target of preview.targets) {
    for (const name of target.prunes) names.add(name);
  }
  return [...names].sort();
}

export function pruneNameCount(preview: SyncPreviewResult | null, kind: SyncPreviewResult["kind"], pruneEnabled: boolean): number {
  if (!preview || preview.kind !== kind || !pruneEnabled) return 0;
  return uniquePruneNames(preview).length;
}
