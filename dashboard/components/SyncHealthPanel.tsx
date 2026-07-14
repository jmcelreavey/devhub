"use client";

import Link from "next/link";
import { AlertTriangle, Check, RefreshCw, ArrowRight } from "lucide-react";
import { SyncPreviewCard } from "@/components/SyncPreviewCard";
import { FetchError, LoadingLine } from "@/components";
import { useLive } from "@/lib/use-fetch";
import type { SyncHealthSummary } from "@/lib/sync-health";

export function SyncHealthPanel() {
  const { data, error, isLoading, mutate } = useLive<SyncHealthSummary>("/api/sync-health");

  if (isLoading) return <LoadingLine message="Checking skill sync health…" />;
  if (error) return <FetchError message={error.message} onRetry={() => void mutate()} />;
  if (!data) return null;

  const issueCount = data.missing.length + data.unreadable.length;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2.5"
        style={{
          background: data.healthy ? "var(--success-dim)" : "var(--warning-dim)",
          border: `1px solid ${data.healthy ? "var(--success)" : "var(--warning)"}`,
        }}
      >
        <div className="flex items-center gap-2 text-sm">
          {data.healthy ? <Check size={14} style={{ color: "var(--success)" }} /> : <AlertTriangle size={14} style={{ color: "var(--warning)" }} />}
          <span style={{ color: "var(--text)" }}>
            {data.healthy ? `Sync health OK - ${data.skillsVerified} checks passed` : `${issueCount} sync issue${issueCount !== 1 ? "s" : ""} across tool directories`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => void mutate()}><RefreshCw size={12} />Refresh</button>
          <Link href="/skills" className="btn btn-ghost text-xs">Agents<ArrowRight size={12} /></Link>
        </div>
      </div>

      {!data.healthy && (
        <div className="card p-3 text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
          {data.missing.slice(0, 8).map((m) => (
            <div key={`${m.tool}-${m.name}`}><span style={{ color: "var(--warning)" }}>MISSING</span> [{m.tool}] {m.name}</div>
          ))}
        </div>
      )}

      {!data.healthy && (
        <>
          <SyncPreviewCard preview={data.skillPreview} loading={false} onRefresh={() => void mutate()} />
          <SyncPreviewCard preview={data.agentPreview} loading={false} onRefresh={() => void mutate()} />
        </>
      )}
    </div>
  );
}
