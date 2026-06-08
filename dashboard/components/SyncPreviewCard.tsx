"use client";

import { RefreshCw } from "lucide-react";
import { uniquePruneNames } from "@/lib/sync-preview-utils";
import type { SyncPreviewResult, SyncPreviewTarget } from "@/lib/sync-preview-types";

interface SyncPreviewCardProps {
  preview: SyncPreviewResult | null;
  loading: boolean;
  onRefresh: () => void;
  /** When set, shows a button to focus local-only rows in the catalog list. */
  onShowPrunableInList?: (names: string[]) => void;
}

function targetChangeCount(target: SyncPreviewTarget): number {
  return target.writes.length + target.prunes.length;
}

function previewTotals(preview: SyncPreviewResult): { writes: number; prunes: number; changedTargets: number } {
  return preview.targets.reduce(
    (acc, target) => ({
      writes: acc.writes + target.writes.length,
      prunes: acc.prunes + target.prunes.length,
      changedTargets: acc.changedTargets + (targetChangeCount(target) > 0 ? 1 : 0),
    }),
    { writes: 0, prunes: 0, changedTargets: 0 },
  );
}

export function SyncPreviewCard({ preview, loading, onRefresh, onShowPrunableInList }: SyncPreviewCardProps) {
  const totals = preview ? previewTotals(preview) : null;
  const changedTargets = preview?.targets.filter((target) => targetChangeCount(target) > 0) ?? [];
  const label = preview?.kind === "agent" ? "agents" : "skills";
  const prunableNames = preview ? uniquePruneNames(preview) : [];

  return (
    <div className="card mb-3" style={{ padding: "12px 14px", borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
            Sync preview
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)", lineHeight: 1.4 }}>
            Shows what Sync {label} will overwrite from the catalog
            {preview?.prune ? " and prune from local tool dirs." : ". Extra local entries are preserved."}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost text-xs shrink-0"
          style={{ display: "flex", alignItems: "center", gap: "4px" }}
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden />
          Refresh
        </button>
      </div>

      {loading && !preview && (
        <p className="text-xs mt-3" style={{ color: "var(--text-subtle)" }}>
          Loading preview…
        </p>
      )}

      {!preview && !loading && (
        <p className="text-xs mt-3" style={{ color: "var(--text-subtle)" }}>
          Preview unavailable. Use Refresh or run Sync to retry.
        </p>
      )}

      {preview && totals && (
        <>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="badge badge-muted">{preview.sourceCount} repo {label}</span>
            <span className="badge badge-muted">{totals.writes} write{totals.writes === 1 ? "" : "s"}</span>
            <span className="badge badge-muted">{totals.prunes} prune{totals.prunes === 1 ? "" : "s"}</span>
            <span className="badge badge-muted">{totals.changedTargets}/{preview.targets.length} targets changing</span>
            {preview.excluded.length > 0 && <span className="badge badge-muted">{preview.excluded.length} ignored</span>}
          </div>
          {preview.prune && totals.prunes > 0 && (
            <div className="text-xs mt-2" style={{ color: "var(--danger)", lineHeight: 1.4 }}>
              <p>
                Prune is enabled. Sync will delete the listed local-only {label}; add them to the catalog first if you
                want to keep them in the repo.
              </p>
              {onShowPrunableInList && prunableNames.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost text-xs mt-2"
                  onClick={() => onShowPrunableInList(prunableNames)}
                >
                  Show {prunableNames.length} in catalog list
                </button>
              ) : null}
            </div>
          )}

          {changedTargets.length === 0 ? (
            <p className="text-xs mt-3" style={{ color: "var(--text-subtle)" }}>
              Local tool dirs already match the repo for included {label}.
            </p>
          ) : (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-1">
              {changedTargets.map((target) => (
                <div key={`${target.tool}:${target.path}`} className="rounded" style={{ background: "var(--bg-elevated)", padding: "8px 10px" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>{target.tool}</span>
                    <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                      {target.writes.length} write{target.writes.length === 1 ? "" : "s"}, {target.prunes.length} prune{target.prunes.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] truncate mt-0.5" style={{ color: "var(--text-subtle)" }} title={target.path}>
                    {target.path}
                  </div>
                  {target.writes.length > 0 && (
                    <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                      Overwrite/install: {target.writes.map((write) => `${write.name} (${write.reason})`).join(", ")}
                    </div>
                  )}
                  {target.prunes.length > 0 && (
                    <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>
                      Prune: {target.prunes.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
