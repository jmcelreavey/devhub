"use client";

import { useRef, useState } from "react";
import { useMinuteTick } from "@/lib/tickers";
import { formatRelativePastAge } from "@/lib/utils";

export function RefreshUpdated({ at, onRefresh, degraded = false }: { at?: string; onRefresh: () => Promise<unknown>; degraded?: boolean }) {
  const now = useMinuteTick();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const last = useRef(0);
  const refresh = async () => {
    if (pending.current || Date.now() - last.current < 1000) return;
    pending.current = true; last.current = Date.now(); setBusy(true); setError(false);
    try { await onRefresh(); } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return <span>
    <button type="button" className="btn btn-ghost text-xs" disabled={busy} aria-busy={busy} title="Refresh data" onClick={() => void refresh()}>
      {busy ? "Refreshing…" : at && now ? `Updated ${formatRelativePastAge(now - Date.parse(at))}${degraded ? " · last-known work" : ""}` : "Refresh data"}
    </button>
    {error ? <span role="alert">Couldn’t refresh. Try again.</span> : null}
  </span>;
}
