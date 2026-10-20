"use client";

import { agentsHref } from "@/lib/agent-handoff";
import { useLive } from "@/lib/hooks/use-fetch";
import Link from "next/link";
import { useState } from "react";

interface CountedRun {
  id: string; title: string; providerLabel: string; state: string; conversationId: string | null;
  createdAt: number; error: string | null; clearable: boolean;
}
interface Capacity { max: number; runs: CountedRun[] }

const STATE_LABEL: Record<string, string> = {
  queued: "Queued", starting: "Starting", running: "Running", "needs-attention": "Needs attention",
};

/**
 * Which agents are using the dispatch limit. A run DevHub can no longer follow
 * can be cleared here; one that is really running has to be stopped from its chat.
 */
export function AgentCapacityPanel({ onFreed }: { onFreed?: () => void }) {
  // Not polled: the sheet is open to act on one answer, and Clear refreshes it.
  const { data: capacity, error: loadError, mutate } = useLive<Capacity>("/api/agent/runs/capacity", {
    refreshInterval: 0, dedupingInterval: 0, revalidateOnFocus: false,
  });
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState<string>();

  async function clear(run: CountedRun) {
    setClearing(run.id); setError("");
    try {
      const response = await fetch(`/api/agent/runs/${encodeURIComponent(run.id)}/clear`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not clear this agent.");
      const next = await mutate();
      if (next && next.runs.length < next.max) onFreed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not clear this agent."); }
    finally { setClearing(undefined); }
  }

  if (!capacity) return <p className="text-xs text-text-muted" role="status">{loadError instanceof Error ? loadError.message : "Checking which agents are running…"}</p>;
  return <div className="space-y-2" aria-label="Agents using the limit">
    <p className="text-xs text-text-muted">{capacity.runs.length} of {capacity.max} agent slots in use. Cleared agents stay running in Paseo if they are; DevHub just stops counting them.</p>
    <ul className="space-y-2">
      {capacity.runs.map((run) => <li key={run.id} className="flex items-start justify-between gap-3 rounded border border-border bg-bg-surface p-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-medium">{run.title}</p>
          <p className="text-xs text-text-muted"><span className={run.clearable ? "badge badge-warning" : "badge badge-muted"}>{STATE_LABEL[run.state] ?? run.state}</span> {run.providerLabel} · started {new Date(run.createdAt).toLocaleString()}</p>
          {run.clearable && run.error && <p className="mt-1 text-xs text-text-muted">{run.error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {run.conversationId && <Link href={agentsHref(run.conversationId, run.id)} className="btn btn-ghost">Open</Link>}
          {run.clearable && <button type="button" className="btn btn-ghost" disabled={clearing === run.id} onClick={() => void clear(run)}>{clearing === run.id ? "Clearing…" : "Clear"}</button>}
        </div>
      </li>)}
    </ul>
    {error && <p className="text-xs text-danger" role="alert">{error}</p>}
  </div>;
}
