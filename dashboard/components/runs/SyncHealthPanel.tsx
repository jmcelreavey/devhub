"use client";

import Link from "next/link";
import { AlertTriangle, Check, RefreshCw, ArrowRight } from "lucide-react";
import { SyncPreviewCard } from "@/components/runs/SyncPreviewCard";
import { FetchError, SkeletonRows } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";
import type { SyncHealthSummary } from "@/lib/sync/health";
import styles from "./SyncHealthPanel.module.css";

export function SyncHealthPanel() {
  const { data, error, isLoading, mutate } = useLive<SyncHealthSummary>("/api/sync-health");

  if (isLoading) return <div role="status" aria-label="Checking skill sync"><SkeletonRows count={2} height={40} variant="list" /></div>;
  if (error) return <FetchError message={error.message} onRetry={() => void mutate()} bare />;
  if (!data) return null;

  const issueCount = data.missing.length + data.unreadable.length;
  const missingByName = new Map<string, string[]>();
  for (const missing of data.missing) {
    const tools = missingByName.get(missing.name) ?? [];
    tools.push(missing.tool);
    missingByName.set(missing.name, tools);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.overview}>
        <div className={styles.heading}>
          {data.healthy ? <Check size={18} className="text-success" aria-hidden /> : <AlertTriangle size={18} className="text-warning" aria-hidden />}
          <div>
            <p className={styles.title}>{data.healthy ? "Your tool configurations are in sync" : `${issueCount} configuration issues to review`}</p>
            <p className={styles.description}>{data.healthy ? `${data.skillsVerified} checks passed.` : "Review missing or unreadable skills, then preview what syncing will change."}</p>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={() => void mutate()} aria-label="Refresh skill sync"><RefreshCw size={14} aria-hidden />Refresh</button>
          <Link href="/skills" className="btn btn-ghost">Open skills<ArrowRight size={14} aria-hidden /></Link>
        </div>
      </div>

      {!data.healthy && (
        <>
          <details className={styles.details}>
            <summary>Review issues <span>{issueCount}</span></summary>
            <ul className={styles.issues}>
              {[...missingByName].map(([name, tools]) => (
                <li key={name}><strong>{name}</strong><p>Missing in {tools.join(", ")}</p></li>
              ))}
              {data.unreadable.map((item) => (
                <li key={`${item.tool}:${item.name}`}><strong>{item.name}</strong><p>Couldn’t read in {item.tool}: {item.error}</p></li>
              ))}
            </ul>
          </details>
          <details className={styles.details}>
            <summary>Preview skill changes</summary>
            <div className={styles.preview}><SyncPreviewCard preview={data.skillPreview} loading={false} onRefresh={() => void mutate()} embedded /></div>
          </details>
          <details className={styles.details}>
            <summary>Preview agent changes</summary>
            <div className={styles.preview}><SyncPreviewCard preview={data.agentPreview} loading={false} onRefresh={() => void mutate()} embedded /></div>
          </details>
        </>
      )}
    </div>
  );
}
