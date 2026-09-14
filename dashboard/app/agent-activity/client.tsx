"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, CircleDashed, Loader2 } from "lucide-react";
import { FetchError, LoadingLine } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { localCalendarDateISO } from "@/lib/local/calendar-date";
import { useMinuteTick } from "@/lib/minute-tick";
import { formatRelativePastAge } from "@/lib/utils";
import { describeAgentEvent, type RecordedAgentRunEvent } from "@/lib/agent-runs/events";
import type { AgentRunSummary } from "@/lib/agent-runs/store";
import type { McpHistoryEntry, McpHistorySummary } from "@shared/mcp-history/index.ts";

/**
 * What agents did through DevHub: runs dispatched with `agent_dispatch`, and
 * every MCP tool call any client made. Both views read files the MCP side
 * writes (run dirs and the daily history JSONL), so they work for runs and
 * calls made while this page was closed.
 */

type Tab = "runs" | "calls";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "runs", label: "Agent runs" },
  { id: "calls", label: "MCP calls" },
];

const SMALL_BTN: CSSProperties = { fontSize: 12, padding: "3px 9px" };
const PRE: CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-muted)",
  maxHeight: 320,
  overflow: "auto",
  fontFamily: "var(--font-mono, monospace)",
};

export default function AgentActivityPage() {
  const [tab, setTab] = useState<Tab>("runs");
  return (
    <div className="page-wrapper">
      <div
        className="page-header"
        style={{ alignItems: "flex-end", marginBottom: "var(--space-6)", gap: "var(--space-4)" }}
      >
        <div>
          <h1 className="page-title" style={{ fontFamily: "var(--font-display)" }}>
            Agent activity
          </h1>
          <div className="text-xs mt-1 text-text-subtle">
            Agent runs dispatched through DevHub, and every MCP tool call made against it.
          </div>
        </div>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Activity views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className="btn btn-ghost"
              style={{ ...SMALL_BTN, background: tab === t.id ? "var(--bg-elevated)" : undefined }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">{tab === "runs" ? <AgentRunsPanel /> : <McpCallsPanel />}</div>
    </div>
  );
}

/* ── Agent runs ─────────────────────────────────────────────────────────── */

interface RunsResponse {
  runs: AgentRunSummary[];
  providers: Array<{ id: string; label: string; installed: boolean; custom: boolean }>;
  providersConfigError: string | null;
}

interface RunPage {
  run: AgentRunSummary;
  events: RecordedAgentRunEvent[];
  next: number;
  total: number;
}

interface RunDiff {
  cwd: string;
  baseSha: string | null;
  stat: string;
  patch: string | null;
  untracked: string[];
  truncated: boolean;
  note: string | null;
}

function isActive(state: AgentRunSummary["state"]): boolean {
  return state === "queued" || state === "running";
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function RunStateIcon({ state }: { state: AgentRunSummary["state"] }) {
  if (state === "succeeded") return <Check size={13} className="text-success shrink-0" aria-label="Succeeded" />;
  if (state === "failed") return <AlertTriangle size={13} className="text-danger shrink-0" aria-label="Failed" />;
  if (state === "cancelled") return <Ban size={13} className="shrink-0 text-text-subtle" aria-label="Cancelled" />;
  if (state === "running") {
    return <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "var(--accent)" }} aria-label="Running" />;
  }
  return <CircleDashed size={13} className="shrink-0 text-text-subtle" aria-label="Queued" />;
}

function AgentRunsPanel() {
  const now = useMinuteTick();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useLive<RunsResponse>("/api/agent/runs?limit=50");

  if (isLoading) return <LoadingLine />;
  if (error) {
    return (
      <FetchError
        bare
        message={error instanceof Error ? error.message : "Could not load agent runs"}
        onRetry={() => void mutate()}
      />
    );
  }

  const runs = data?.runs ?? [];
  const installed = (data?.providers ?? []).filter((p) => p.installed).map((p) => p.label);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-subtle">
        {runs.length} recent run{runs.length === 1 ? "" : "s"} · providers: {installed.join(", ") || "none installed"}
        {data?.providersConfigError ? <span className="text-danger"> · {data.providersConfigError}</span> : null}
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-text-subtle">
          No agent runs yet. An MCP client starts one with <code>agent_dispatch</code>; each run opens its own terminal tab.
        </p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((run) => {
            const open = openId === run.id;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : run.id)}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-elevated)]"
                  style={{ color: "var(--text)" }}
                >
                  {open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
                  <RunStateIcon state={run.state} />
                  <span className="shrink-0 w-24 truncate text-xs text-text-subtle">{run.providerLabel}</span>
                  <span className="truncate flex-1 min-w-0">{run.title}</span>
                  <span className="shrink-0 w-28 truncate text-right text-xs text-text-subtle" title={run.cwd}>
                    {run.worktree ? run.worktree.branch.replace("devhub/agent/", "⎇ ") : basename(run.cwd)}
                  </span>
                  <span className="shrink-0 w-16 text-right text-xs tabular-nums text-text-subtle">
                    {formatRelativePastAge(Math.max(0, now - run.createdAt))}
                  </span>
                </button>
                {open && <RunDetail runId={run.id} onChanged={() => void mutate()} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function eventTone(event: RecordedAgentRunEvent): string {
  if (event.type === "error" || (event.type === "tool_result" && !event.ok) || (event.type === "result" && !event.ok)) {
    return "text-danger";
  }
  if (event.type === "stderr" || event.type === "session" || event.type === "tool_result") return "text-text-subtle";
  return "";
}

function RunDetail({ runId, onChanged }: { runId: string; onChanged: () => void }) {
  const toast = useToast();
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, mutate } = useLive<RunPage>(`/api/agent/runs/${encodeURIComponent(runId)}?limit=500`);

  if (isLoading) {
    return (
      <div className="px-8 py-2">
        <LoadingLine />
      </div>
    );
  }
  if (error || !data) {
    return <FetchError bare message="Could not load this run" onRetry={() => void mutate()} />;
  }

  const { run, events, total } = data;
  const active = isActive(run.state);

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
      if (res.ok) toast.success("Stop requested.");
      else toast.error(`Could not stop the run (HTTP ${res.status}).`);
      void mutate();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function loadDiff() {
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/diff`);
      const body = (await res.json().catch(() => ({}))) as { diff?: RunDiff; error?: string };
      if (res.ok && body.diff) setDiff(body.diff);
      else toast.error(body.error ?? `Could not load the diff (HTTP ${res.status}).`);
    } finally {
      setBusy(false);
    }
  }

  const meta = [
    run.id,
    run.model,
    run.worktree ? `worktree ${run.worktree.path}` : run.cwd,
    run.turns !== null ? `${run.turns} turns` : null,
    run.exitCode !== null ? `exit ${run.exitCode}` : null,
    run.parentRunId ? `follow-up of ${run.parentRunId}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2 px-8 pb-3 pt-1 text-xs">
      <div className="text-text-subtle break-all">{meta.join(" · ")}</div>
      {run.error && <div className="text-danger">{run.error}</div>}
      {!active && run.resultText && (
        <pre className="whitespace-pre-wrap rounded p-2" style={PRE}>
          {run.resultText}
        </pre>
      )}

      <div className="flex gap-1.5">
        {active && (
          <button type="button" className="btn btn-ghost" style={SMALL_BTN} disabled={busy} onClick={() => void stop()}>
            Stop run
          </button>
        )}
        <button type="button" className="btn btn-ghost" style={SMALL_BTN} disabled={busy} onClick={() => void loadDiff()}>
          {diff ? "Refresh diff" : "Show diff"}
        </button>
      </div>

      {diff && (
        <pre className="whitespace-pre-wrap rounded p-2" style={PRE}>
          {[
            diff.note,
            diff.stat || "No tracked changes.",
            diff.untracked.length ? `Untracked:\n${diff.untracked.join("\n")}` : null,
            diff.patch,
            diff.truncated ? "(patch truncated)" : null,
          ]
            .filter(Boolean)
            .join("\n\n")}
        </pre>
      )}

      <div className="text-text-subtle">
        {total} event{total === 1 ? "" : "s"}
        {total > events.length ? `, first ${events.length} shown` : ""}
      </div>
      {events.length > 0 && (
        <ol className="flex flex-col gap-0.5 rounded p-2" style={PRE}>
          {events.map((event) => (
            <li key={event.seq} className={`whitespace-pre-wrap break-words ${eventTone(event)}`}>
              {describeAgentEvent(event)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── MCP calls ──────────────────────────────────────────────────────────── */

interface HistoryResponse {
  date: string;
  total: number;
  summary: McpHistorySummary;
  entries: McpHistoryEntry[];
}

function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

function formatMs(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${ms}ms`;
}

function McpCallsPanel() {
  const [date, setDate] = useState(() => localCalendarDateISO());
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [toolDraft, setToolDraft] = useState("");
  const [tool, setTool] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const query = new URLSearchParams({ date, limit: "300" });
  if (errorsOnly) query.set("errorsOnly", "1");
  if (tool) query.set("tool", tool);
  const { data, error, isLoading, mutate } = useLive<HistoryResponse>(`/api/mcp-history?${query.toString()}`);

  function applyTool(e: FormEvent) {
    e.preventDefault();
    setTool(toolDraft.trim());
  }

  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-wrap items-center gap-2 text-xs" onSubmit={applyTool}>
        <input
          type="date"
          value={date}
          max={localCalendarDateISO()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="input"
          style={{ width: 160 }}
          aria-label="Day"
        />
        <input
          type="search"
          value={toolDraft}
          onChange={(e) => setToolDraft(e.target.value)}
          placeholder="Tool, e.g. agent_*"
          className="input"
          style={{ width: 220 }}
          aria-label="Filter by tool"
        />
        <button type="submit" className="btn btn-ghost" style={SMALL_BTN}>
          Filter
        </button>
        <button
          type="button"
          aria-pressed={errorsOnly}
          onClick={() => setErrorsOnly((v) => !v)}
          className="btn btn-ghost"
          style={{ ...SMALL_BTN, background: errorsOnly ? "var(--bg-elevated)" : undefined }}
        >
          Failures only
        </button>
      </form>

      {isLoading ? (
        <LoadingLine />
      ) : error ? (
        <FetchError
          bare
          message={error instanceof Error ? error.message : "Could not load MCP history"}
          onRetry={() => void mutate()}
        />
      ) : !summary || summary.total === 0 ? (
        <p className="text-sm text-text-subtle">No matching MCP calls recorded for {date}.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-xs text-text-subtle">
            <span>
              {summary.total} call{summary.total === 1 ? "" : "s"} · {summary.failed} failed · {summary.actions.length} action
              {summary.actions.length === 1 ? "" : "s"}
              {summary.agentRunIds.length ? ` · ${summary.agentRunIds.length} from agent runs` : ""}
            </span>
            <span>Clients: {summary.clients.map((c) => `${c.client} (${c.count})`).join(", ")}</span>
            <span>
              Top tools:{" "}
              {summary.tools
                .slice(0, 8)
                .map((t) => `${t.tool} ${t.count}`)
                .join(", ")}
            </span>
          </div>

          <ul className="flex flex-col">
            {(data?.entries ?? []).map((entry, index) => {
              const key = `${entry.ts}-${entry.tool}-${index}`;
              const open = openKey === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : key)}
                    className="w-full flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--bg-elevated)]"
                    style={{ color: "var(--text)" }}
                  >
                    <span className="shrink-0 w-16 text-xs tabular-nums text-text-subtle">{clock(entry.ts)}</span>
                    {entry.ok ? (
                      <Check size={13} className="text-success shrink-0" aria-label="Succeeded" />
                    ) : (
                      <AlertTriangle size={13} className="text-danger shrink-0" aria-label="Failed" />
                    )}
                    <span className="truncate flex-1 min-w-0 font-mono text-xs">{entry.tool}</span>
                    <span className="shrink-0 w-32 truncate text-right text-xs text-text-subtle">{entry.client ?? ""}</span>
                    <span className="shrink-0 w-14 text-right text-xs tabular-nums text-text-subtle">
                      {formatMs(entry.durationMs)}
                    </span>
                  </button>
                  {open && (
                    <pre className="mx-8 mb-2 whitespace-pre-wrap break-words rounded p-2 text-xs" style={PRE}>
                      {[
                        entry.error ? `error: ${entry.error}` : null,
                        entry.agentRunId ? `agent run: ${entry.agentRunId}` : null,
                        entry.toolset ? `toolset: ${entry.toolset}` : null,
                        `cwd: ${entry.cwd}`,
                        `result: ${entry.resultChars} chars`,
                        `args: ${JSON.stringify(entry.args, null, 2)}`,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
          {data && data.total > data.entries.length && (
            <p className="text-xs text-text-subtle">
              Showing the newest {data.entries.length} of {data.total}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
