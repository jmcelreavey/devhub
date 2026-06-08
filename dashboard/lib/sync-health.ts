import { verifySync } from "./sync-skills";
import { buildSyncPreview } from "./sync-preview";
import type { SyncPreviewResult } from "./sync-preview-types";

export interface SyncHealthSummary {
  healthy: boolean;
  skillsVerified: number;
  missing: Array<{ tool: string; name: string }>;
  unreadable: Array<{ tool: string; name: string; error: string }>;
  skillPreview: SyncPreviewResult | null;
  agentPreview: SyncPreviewResult | null;
}

export async function collectSyncHealth(repoRoot: string): Promise<SyncHealthSummary> {
  const verify = await verifySync({ repoRoot, emit: () => {} });
  const healthy = verify.missing.length === 0 && verify.unreadable.length === 0;
  return {
    healthy,
    skillsVerified: verify.healthy,
    missing: verify.missing,
    unreadable: verify.unreadable,
    skillPreview: healthy ? null : buildSyncPreview({ kind: "skill", repoRoot, prune: false }),
    agentPreview: healthy ? null : buildSyncPreview({ kind: "agent", repoRoot, prune: false }),
  };
}
