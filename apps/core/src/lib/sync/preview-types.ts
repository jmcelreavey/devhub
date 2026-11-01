export type SyncPreviewKind = "skill" | "agent";

export type SyncPreviewChangeReason = "missing" | "changed";

export interface SyncPreviewWrite {
  name: string;
  reason: SyncPreviewChangeReason;
}

export interface SyncPreviewTarget {
  tool: string;
  path: string;
  writes: SyncPreviewWrite[];
  prunes: string[];
  unchanged: number;
}

export interface SyncPreviewResult {
  kind: SyncPreviewKind;
  sourceCount: number;
  excluded: string[];
  prune: boolean;
  targets: SyncPreviewTarget[];
}
