"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hammer, RotateCw } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { isDesktop } from "@/lib/desktop/bridge";
import type { RebuildStatus } from "@/lib/desktop/checkout-rebuild";
import { useLive } from "@/lib/hooks/use-fetch";

interface RebuildPayload {
  available: boolean;
  mode: "service" | "payload" | null;
  checkoutAhead: boolean;
  reason?: string;
  status: RebuildStatus | null;
  log: string;
  restartRequired?: boolean;
}

function phaseTone(state: string): string {
  if (state === "done" || state === "skipped") return "badge badge-success";
  if (state === "failed") return "badge badge-danger";
  if (state === "running") return "badge badge-warning";
  return "badge badge-muted";
}

function phaseWord(state: string): string {
  if (state === "done") return "Done";
  if (state === "skipped") return "Skipped";
  if (state === "failed") return "Failed";
  if (state === "running") return "Now";
  if (state === "interrupted") return "Stopped";
  return "Waiting";
}

/** A phase left "running" when the whole rebuild was interrupted is not still going. */
function shownPhaseState(phaseState: string, overall: string | undefined): string {
  if (overall === "interrupted" && phaseState === "running") return "interrupted";
  return phaseState;
}

/**
 * Pull the linked checkout and rebuild the app that is actually running.
 *
 * Hidden when this machine should use the older Rebuild & restart card
 * (macOS, or a checkout dev server). The parent learns that from `onAvailability`.
 */
export function CheckoutRebuildCard({
  onAvailability,
  autoStart = false,
}: {
  onAvailability?: (available: boolean | null) => void;
  autoStart?: boolean;
}) {
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const { data, error, mutate } = useLive<RebuildPayload>("/api/rebuild", {
    refreshInterval: 2000,
    dedupingInterval: 500,
  });

  useEffect(() => {
    if (!data && !error) {
      onAvailability?.(null);
      return;
    }
    onAvailability?.(Boolean(data?.available));
  }, [data, error, onAvailability]);

  const start = useCallback(async () => {
    setPosting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pull: true }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!res.ok) {
        setNotice(body?.error ?? "Couldn't start the rebuild.");
        return;
      }
      setNotice(body?.message ?? "Rebuild started.");
      await mutate();
    } catch {
      setNotice("Couldn't start the rebuild.");
    } finally {
      setPosting(false);
    }
  }, [mutate]);

  useEffect(() => {
    if (!autoStart || autoStarted.current || !data?.available) return;
    if (data.status?.state === "running") return;
    autoStarted.current = true;
    const timer = window.setTimeout(() => {
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoStart, data?.available, data?.status?.state, start]);

  if (error || (data && !data.available)) return null;

  async function relaunch() {
    const api = (window as unknown as { __TAURI__?: { core: { invoke: (command: string) => Promise<void> } } }).__TAURI__;
    if (!api) return;
    await api.core.invoke("relaunch");
  }

  if (!data) {
    return (
      <div className="card min-w-0">
        <div className="card-body" style={{ padding: "12px 16px" }}>
          <p className="text-xs text-text-subtle">Checking whether this app can rebuild from the checkout…</p>
        </div>
      </div>
    );
  }

  const interrupted = data.status?.state === "interrupted";
  const running = data.status?.state === "running" || posting;
  const restartRequired = data.restartRequired === true || data.status?.restartRequired === true;

  return (
    <div className="card min-w-0">
      <div className="card-header" style={{ padding: "12px 16px" }}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Rebuild from checkout</h2>
          <p className="text-xs text-text-muted">
            {data.mode === "service"
              ? "Pull, build beside the running service, and restart it only when the new build is up."
              : "Pull and build a server from the linked checkout. Restart DevHub to start using it."}
            {data.checkoutAhead ? " The checkout is ahead of the build that is running." : ""}
          </p>
        </div>
      </div>
      <div className="card-body flex flex-col gap-3" style={{ padding: "12px 16px" }}>
        {data.status && data.status.phases.length > 0 && (
          <ol className="flex flex-col gap-1">
            {data.status.phases.map((phase) => {
              const shown = shownPhaseState(phase.state, data.status?.state);
              return (
                <li key={phase.id} className="flex items-center gap-2 text-xs">
                  <span className={phaseTone(shown)}>{phaseWord(shown)}</span>
                  <span>{phase.label}</span>
                </li>
              );
            })}
          </ol>
        )}
        {interrupted && (
          <p className="text-xs text-text-muted">
            {data.status?.error ?? "The last rebuild was interrupted before it finished."} You can run it again.
          </p>
        )}
        {data.status?.error && !interrupted && (
          <p className="text-xs" role="alert" style={{ color: "var(--danger)" }}>{data.status.error}</p>
        )}
        {data.status?.rolledBack && (
          <p className="text-xs text-text-muted">The previous build was put back and restarted.</p>
        )}
        {notice && <p className="text-xs text-text-muted">{notice}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => void start()} disabled={running}>
            {running ? <RotateCw size={12} className="animate-spin" /> : <Hammer size={12} />}
            {running ? "Rebuilding…" : "Pull and rebuild"}
          </button>
          {restartRequired && isDesktop() && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void relaunch()}>
              Restart DevHub
            </button>
          )}
        </div>
        {data.log && (
          <details>
            <summary className="cursor-pointer text-xs text-text-muted">Log</summary>
            <div className="mt-2 flex flex-col gap-2">
              <CopyButton text={data.log} label="rebuild log" />
              <pre className="text-xs text-text-muted" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{data.log}</pre>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
