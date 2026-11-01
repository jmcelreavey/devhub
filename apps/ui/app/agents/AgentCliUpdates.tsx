"use client";

import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useMinuteTick } from "@/lib/tickers";
import type { CliUpdateStatus } from "../../../core/src/lib/paseo/cli-update-types";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

export function AgentCliUpdates() {
  const { data, error, mutate } = useLive<CliUpdateStatus>("/api/paseo/cli-updates");
  const { data: external } = useLive<Pick<CliUpdateStatus, "installed" | "lock">>("/api/paseo/cli-updates?external=1", { /* Installed CLI versions can change outside DevHub. */ refreshInterval: 30_000 });
  const now = useMinuteTick();
  const installed = external?.installed ?? data?.installed ?? [];
  const lock = data?.lock;
  const recoverable = lock?.held && external?.lock.held && lock.ownerPid === external.lock.ownerPid
    ? external.lock.recoverable : lock?.recoverable;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  async function save(change: Record<string, string | boolean>) {
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/paseo/cli-updates", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t save update preferences.");
      await mutate(result, false);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "Couldn’t save update preferences.");
    } finally { setSaving(false); }
  }

  return <section className="card p-5 space-y-3" aria-labelledby="cli-updates-title">
    <div className="flex items-center justify-between gap-3">
      <h3 id="cli-updates-title" className="font-medium">Agent CLI updates</h3>
      {data ? <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={data.enabled} disabled={saving} onChange={(event) => void save({ enabled: event.target.checked })} />
        Daily updates
      </label> : null}
    </div>
    <p className="text-xs text-text-muted">Updates wait for idle chats and share a lock with other local apps. Hold a version while you finish a piece of work.</p>
    {!data && !error ? <SkeletonRows count={3} height={36} /> : null}
    {error ? <FetchError message={error.message} onRetry={() => void mutate()} /> : null}
    {lock?.held ? <p className="tone-panel tone-panel--warning text-xs" role="status">
      {recoverable ? "The previous updater stopped. DevHub will recover its lock on the next daily check." : "The shared update lock is held. Updates will wait until it is released."}
    </p> : null}
    <ul className="divide-y divide-border">{data && installed.map((agent) => {
      const pinned = data.pinned.includes(agent);
      const skipped = data.skippedUntil[agent] > (now || data.checkedAt);
      return <li key={agent} className="flex flex-wrap items-center gap-3 py-2 text-sm">
        <span className="flex-1 font-medium">{agent}</span>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={pinned} disabled={saving} onChange={(event) => void save({ agent, pinned: event.target.checked })} />Hold version
        </label>
        <button type="button" className="btn btn-ghost text-xs" disabled={saving || pinned} onClick={() => void save({ agent, skip: !skipped })}>{skipped ? "Resume updates" : "Skip 24 hours"}</button>
      </li>;
    })}</ul>
    {data && installed.length === 0 ? <p className="text-xs text-text-subtle">No supported standalone CLI installation found. App-managed agents follow their app’s updates.</p> : null}
    {saveError ? <p role="alert" className="text-xs text-warning">{saveError} Your previous preferences still apply.</p> : null}
    <details>
      <summary className="cursor-pointer text-xs text-text-muted">Update history{data?.history.length ? ` · ${data.history.length}` : ""}</summary>
      {data?.history.length ? <ol className="mt-2 max-h-64 overflow-y-auto space-y-2">{data.history.slice(-20).reverse().map((entry, index) =>
        <li key={`${entry.at}-${index}`} className="text-xs">
          <span className="font-medium">{entry.agent} · {entry.status}</span>
          <time className="ml-2 text-text-subtle" dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time>
          <p className="mt-0.5 break-words text-text-muted">{entry.message}</p>
        </li>
      )}</ol> : <p className="mt-2 text-xs text-text-subtle">No checks recorded yet.</p>}
    </details>
    <p className="text-xs text-text-subtle">npm installations continue through Safe-Chain. Holding a version prevents future updates; it does not downgrade an installed CLI.</p>
  </section>;
}
