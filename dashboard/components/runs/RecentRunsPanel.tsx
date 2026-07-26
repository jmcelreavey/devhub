"use client";

import { useState } from "react";
import { Check, AlertTriangle, CircleDashed, RotateCw } from "lucide-react";
import { FetchError, LoadingLine } from "@/components";
import { RunLogModal } from "@/components/runs/RunLogModal";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { useMinuteTick } from "@/lib/minute-tick";
import { formatRelativePastAge } from "@/lib/utils";
import type { RunHistoryRow } from "@/lib/run-history";
import type { ScriptCatalogEntry } from "@/lib/scripts-runner";

/**
 * Answers "what has DevHub actually been doing?" from the audit log at
 * ~/.local/state/devhub/runs.jsonl — which scripts-runner has been writing
 * since forever and nothing had ever read back.
 *
 * Failures are what you scan for, so failures get the affordance: a filter
 * that defaults to off, and an icon you can find without reading the text.
 */
export function RecentRunsPanel() {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  // Only needed to tell the user whether the thing they're re-running writes
  // anything. Cheap, cached by SWR, and shared with the Actions page.
  const { data: catalogData } = useLive<{ catalog: ScriptCatalogEntry[] }>("/api/scripts");
  // Shared 1/min ticker, so the relative ages stay honest without this panel
  // owning an interval of its own.
  const now = useMinuteTick();
  const { data, error, isLoading, mutate } = useLive<{ runs: RunHistoryRow[] }>(
    "/api/scripts/runs?limit=25",
  );

  if (isLoading) return <LoadingLine />;
  // `bare` — this panel already sits inside a `.card`, so the boxed variant
  // would render a card inside a card.
  if (error)
    return (
      <FetchError
        bare
        message={error instanceof Error ? error.message : "Could not load run history"}
        onRetry={() => void mutate()}
      />
    );

  const all = data?.runs ?? [];
  const failureCount = all.filter((r) => !r.ok).length;
  const rows = failuresOnly ? all.filter((r) => !r.ok) : all;

  /**
   * Re-runs a failed script.
   *
   * Deliberately behind a confirm dialog rather than one click. The history log
   * records only the script id — not the options it was originally given
   * (excluded skills, a commit message, and so on). So a retry is "run this
   * again with defaults", which is usually what you want and occasionally very
   * much not. The dialog says so, and says louder when the script writes.
   */
  async function retry(row: RunHistoryRow) {
    const entry = catalogData?.catalog.find((c) => c.id === row.script);
    const mutates = entry?.mutates ?? true; // unknown script: assume the risky answer
    const ok = await confirm({
      title: `Run ${entry?.label ?? row.script} again?`,
      message: mutates
        ? "This runs with default options — not whatever options the failed run used — and it makes changes."
        : "This runs with default options, not whatever options the failed run used.",
      confirmLabel: "Run again",
      variant: mutates ? "danger" : "default",
    });
    if (!ok) return;

    setRetrying(row.runId);
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: row.script }),
      });
      if (!res.ok) {
        toast.error(`Could not start ${row.script} (HTTP ${res.status}).`);
        return;
      }
      toast.success(`Started ${entry?.label ?? row.script}.`);
      // The audit line is only appended when the run finishes, so there is
      // nothing new to read yet; revalidate anyway so a fast script appears.
      void mutate();
    } catch {
      toast.error(`Could not start ${row.script}.`);
    } finally {
      setRetrying(null);
    }
  }

  if (all.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
        No runs recorded yet. Anything you launch from Actions shows up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
          Last {all.length} run{all.length === 1 ? "" : "s"}
          {failureCount > 0 ? ` · ${failureCount} failed` : ""}
        </span>
        {failureCount > 0 && (
          <button
            type="button"
            onClick={() => setFailuresOnly((v) => !v)}
            aria-pressed={failuresOnly}
            className="text-xs rounded px-2 py-1"
            style={{
              border: "1px solid var(--border-muted)",
              background: failuresOnly ? "var(--bg-elevated)" : "transparent",
              color: failuresOnly ? "var(--text)" : "var(--text-subtle)",
            }}
          >
            Failures only
          </button>
        )}
      </div>

      <ul className="flex flex-col">
        {rows.map((run) => (
          <li key={run.runId} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOpenRunId(run.runId)}
              className="flex-1 min-w-0 flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-elevated)]"
              style={{ color: "var(--text)" }}
            >
              {run.finishedAt === undefined ? (
                <CircleDashed
                  size={13}
                  className="shrink-0"
                  style={{ color: "var(--text-subtle)" }}
                  aria-label="No finish recorded"
                />
              ) : run.ok ? (
                <Check size={13} className="text-success shrink-0" aria-label="Succeeded" />
              ) : (
                <AlertTriangle size={13} className="text-danger shrink-0" aria-label="Failed" />
              )}

              <span className="truncate flex-1 min-w-0">{run.script}</span>

              {/* Fixed-width right-aligned columns. Without them the exit badge
                  shoves the duration and age around and the eye can't run down
                  a straight edge to compare timings. */}
              <span className="text-xs tabular-nums shrink-0 w-12 text-right text-danger">
                {run.exitCode !== undefined && run.exitCode !== 0 ? `exit ${run.exitCode}` : ""}
              </span>
              <span
                className="text-xs tabular-nums shrink-0 w-14 text-right"
                style={{ color: "var(--text-subtle)" }}
              >
                {run.durationMs !== undefined ? formatDuration(run.durationMs) : ""}
              </span>
              <span
                className="text-xs tabular-nums shrink-0 w-16 text-right"
                style={{ color: "var(--text-subtle)" }}
              >
                {formatRelativePastAge(Math.max(0, now - run.startedAt))}
              </span>
            </button>

            {/* Retry is offered only where it means something: a run that
                failed. Successful runs are re-run from the Actions page, with
                their options in front of you.

                The slot is rendered on every row regardless, because a button
                that exists only on failures makes the timestamp column jump
                left and right down the list. Reserved width, empty when unused. */}
            <span className="shrink-0 w-7 flex justify-end">
              {!run.ok && (
                <button
                  type="button"
                  onClick={() => void retry(run)}
                  disabled={retrying !== null}
                  title={`Run ${run.script} again`}
                  aria-label={`Run ${run.script} again`}
                  className="rounded p-1.5 hover:bg-[var(--bg-elevated)] disabled:opacity-40"
                  style={{ color: "var(--text-subtle)" }}
                >
                  <RotateCw size={13} className={retrying === run.runId ? "animate-spin" : ""} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <RunLogModal
        open={openRunId !== null}
        runId={openRunId}
        onClose={() => setOpenRunId(null)}
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
