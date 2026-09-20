"use client";

import { FetchError,LoadingLine } from "@/components";
import { agentsHref,requestAgentConversation } from "@/lib/agent-handoff";
import { describeAgentEvent,type RecordedAgentRunEvent } from "@/lib/agent-runs/events";
import type { AgentRunSummary } from "@/lib/agent-runs/store";
import type { IndexedConversation } from "@/lib/aionui/conversation-index";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { localCalendarDateISO } from "@/lib/local/calendar-date";
import { useMinuteTick } from "@/lib/minute-tick";
import { formatRelativePastAge } from "@/lib/utils";
import type { McpHistoryEntry,McpHistorySummary } from "@shared/mcp-history/index.ts";
import { AlertTriangle,Ban,Check,ChevronDown,ChevronRight,CircleDashed } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState,type CSSProperties,type FormEvent } from "react";

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
  const search = useSearchParams();
  const runParam = search.get("run")?.trim() || null;
  // Remount when ?run= changes so tab/openId init from the URL without an effect.
  return <AgentActivityInner key={runParam ?? "no-run"} runParam={runParam} />;
}

function AgentActivityInner({ runParam }: { runParam: string | null }) {
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
            Coding work, AI generation and MCP calls across DevHub.
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
      <div className="card card-body">{tab === "runs" ? <AgentRunsPanel initialRunId={runParam} /> : <McpCallsPanel />}</div>
    </div>
  );
}

function DirectChats({ attention, query }: { attention: boolean; query: string }) {
  const { data } = useLive<{ conversations: IndexedConversation[]; offline?: boolean }>("/api/aionui/conversations", { refreshInterval: 60_000 });
  if (!data?.conversations.length) return null;
  return <div className="mt-6 border-t border-border pt-4">
    <h3 className="text-sm font-medium mb-2">Conversations started in AionUi</h3>
    {data.offline && <p className="text-xs text-text-muted mb-2">Showing saved history. Reconnect the workspace to open these chats.</p>}
    <ul className="space-y-2">{data.conversations.filter(chat => (!attention || chat.state === "needs-attention") && chat.title.toLowerCase().includes(query.toLowerCase())).map(chat => <li key={chat.connectionId + chat.id} className="flex gap-3 items-center text-sm">
      <span className="text-xs text-text-subtle w-24 truncate">{chat.assistant}</span>
      {data.offline ? <span className="flex-1">{chat.title}</span> : <Link href={agentsHref(chat.id)} onClick={() => requestAgentConversation(chat.id)} className="flex-1 text-accent">{chat.title}</Link>}
      <span className="text-xs text-text-muted">{chat.state === "needs-attention" ? "Needs attention" : chat.state === "running" ? "Running" : "Idle"}</span>
    </li>)}</ul>
  </div>;
}

/* ── Agent runs ─────────────────────────────────────────────────────────── */

interface RunsResponse {
  runs: AgentRunSummary[];
  total: number;
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
  return state === "queued" || state === "starting" || state === "running" || state === "needs-attention";
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function RunStateIcon({ state }: { state: AgentRunSummary["state"] }) {
  if (state === "completed") return <Check size={13} className="text-text-muted shrink-0" aria-label="Finished; outcome not verified" />;
  if (state === "succeeded") return <Check size={13} className="text-success shrink-0" aria-label="Succeeded" />;
  if (state === "failed") return <AlertTriangle size={13} className="text-danger shrink-0" aria-label="Failed" />;
  if (state === "needs-attention") return <AlertTriangle size={13} className="text-warning shrink-0" aria-label="Needs attention" />;
  if (state === "cancelled") return <Ban size={13} className="shrink-0 text-text-subtle" aria-label="Cancelled" />;
  if (state === "running") {
    return <CircleDashed size={13} className="shrink-0" style={{ color: "var(--accent)" }} aria-label="Running" />;
  }
  return <CircleDashed size={13} className="shrink-0 text-text-subtle" aria-label={state === "starting" ? "Starting" : "Queued"} />;
}

function AgentRunsPanel({ initialRunId }: { initialRunId?: string | null }) {
  const now = useMinuteTick();
  const [openId, setOpenId] = useState<string | null>(initialRunId ?? null);
  const [limit, setLimit] = useState(50);
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const { data, error, isLoading, mutate } = useLive<RunsResponse>(`/api/agent/runs?limit=${limit}&scope=${scope}&q=${encodeURIComponent(query)}`, { keepPreviousData: true });

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
  const groups = new Map<string, AgentRunSummary[]>();
  for (const run of runs) {
    if (run.runtime !== "generation" || !run.activity?.groupId) continue;
    const group = groups.get(run.activity.groupId) ?? [];
    group.push(run); groups.set(run.activity.groupId, group);
  }
  const groupedIds = new Set([...groups.values()].filter(group => group.length > 1).flatMap(group => group.map(run => run.id)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 items-center" aria-label="Filter activity">
        {[['all', 'All'], ['mine', 'Mine'], ['background', 'Background'], ['attention', 'Needs attention']].map(([value, label]) => <button key={value} className={scope === value ? "btn btn-primary" : "btn btn-ghost"} aria-pressed={scope === value} onClick={() => { setScope(value); setLimit(50); }}>{label}</button>)}
        <input className="input flex-1 min-w-48" aria-label="Search activity" placeholder="Search title, repository, task or job…" value={query} onChange={event => { setQuery(event.target.value); setLimit(50); }} />
      </div>
      {initialRunId && !runs.some(run => run.id === initialRunId) && <RunDetail runId={initialRunId} onChanged={() => void mutate()} />}
      <div className="text-xs text-text-subtle" style={{ paddingTop: 2, paddingBottom: 6 }}>
        {runs.length} of {data?.total ?? runs.length} runs · agents: {installed.join(", ") || "none ready"}
        {data?.providersConfigError ? <span className="text-danger"> · {data.providersConfigError}</span> : null}
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-text-subtle">
          No activity yet. Coding work and AI requests will appear here as they run.
        </p>
      ) : (
        <ul className="flex flex-col">
          {runs.filter(run => !groupedIds.has(run.id)).map((run) => {
            const open = openId === run.id;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : run.id)}
                  className="row-select agent-activity-row w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-elevated)]"
                  style={{ color: "var(--text)" }}
                >
                  {open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
                  <RunStateIcon state={run.state} />
                  <span className="shrink-0 w-24 truncate text-xs text-text-subtle">{run.providerLabel}</span>
                  <span className="truncate flex-1 min-w-0">{run.title}</span>
                  <span className="hidden xl:inline text-xs text-text-subtle">{run.activity?.source}</span>
                  <span className="shrink-0 w-28 truncate text-right text-xs text-text-subtle" title={run.cwd}>
                    {run.worktree ? run.worktree.branch.replace("devhub/agent/", "⎇ ") : basename(run.cwd)}
                  </span>
                  <span className="shrink-0 w-16 text-right text-xs tabular-nums text-text-subtle">
                    {formatRelativePastAge(Math.max(0, now - run.createdAt))}
                  </span>
                </button>
                {open ? <RunDetail runId={run.id} onChanged={() => void mutate()} /> : null}
              </li>
            );
          })}
          {[...groups.entries()].filter(([, group]) => group.length > 1).map(([id, group]) => <li key={id}><details className="p-2" open={group.some(run => run.id === initialRunId)}><summary className="text-sm cursor-pointer">{group[0].title} · {group.length} AI requests</summary><div className="space-y-2 mt-2">{group.map(run => <details key={run.id} open={run.id === initialRunId}><summary className="text-xs cursor-pointer flex gap-2"><RunStateIcon state={run.state} />{run.title} · {run.model || run.providerLabel}</summary><RunDetail runId={run.id} onChanged={() => void mutate()} /></details>)}</div></details></li>)}
        </ul>
      )}
      {(data?.total ?? 0) > runs.length && limit < 2000 && <button className="btn btn-ghost self-start" onClick={() => setLimit(value => value + 100)}>Show older activity</button>}
      {limit >= 2000 && (data?.total ?? 0) > runs.length && <p className="text-xs text-text-muted">Narrow the search to find older activity.</p>}
      {scope !== "background" && <DirectChats attention={scope === "attention"} query={query} />}
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
    run.activity?.source,
    run.model,
    run.worktree ? `worktree ${run.worktree.path}` : run.cwd,
    run.turns !== null ? `${run.turns} turns` : null,
    run.exitCode !== null ? `exit ${run.exitCode}` : null,
    run.parentRunId ? `follow-up of ${run.parentRunId}` : null,
    run.inputTokens != null ? `${run.inputTokens} input tokens` : null,
    run.outputTokens != null ? `${run.outputTokens} output tokens` : null,
  ].filter(Boolean);

  return (
    <div className="agent-activity-detail flex flex-col gap-2 px-8 pb-3 pt-1 text-xs">
      <div className="text-text-subtle break-all">{meta.join(" · ")}</div>
      {run.error && <div className="text-danger">{run.error}</div>}
      {run.state === "completed" && <p className="text-text-muted">The agent has stopped and its reply is available. Open the chat to review the result.</p>}
      {!active && run.resultText && (
        <pre className="whitespace-pre-wrap rounded p-2" style={PRE}>
          {run.resultText}
        </pre>
      )}

      <div className="flex gap-1.5">
        {run.conversationId && <Link href={agentsHref(run.conversationId)} onClick={() => requestAgentConversation(run.conversationId!)} className="btn btn-primary" style={SMALL_BTN}>Open chat</Link>}
        {run.activity?.notePath && <Link className="btn btn-ghost" style={SMALL_BTN} href={`/notes/${run.activity.notePath.split("/").map(encodeURIComponent).join("/")}`}>View result</Link>}
        {run.activity?.taskId && <Link className="btn btn-ghost" style={SMALL_BTN} href={`/work?date=${encodeURIComponent(run.activity.taskDate || "")}&task=${encodeURIComponent(run.activity.taskId)}`}>Task</Link>}
        {run.activity?.prUrl && <a className="btn btn-ghost" style={SMALL_BTN} href={run.activity.prUrl} target="_blank" rel="noreferrer">Pull request</a>}
        {run.activity?.jobId && <Link className="btn btn-ghost" style={SMALL_BTN} href="/actions">Schedule</Link>}
        {active && run.runtime !== "generation" && (
          <button type="button" className="btn btn-ghost" style={SMALL_BTN} disabled={busy} onClick={() => void stop()}>
            Stop run
          </button>
        )}
        {run.runtime !== "generation" && <button type="button" className="btn btn-ghost" style={SMALL_BTN} disabled={busy} onClick={() => void loadDiff()}>
          {diff ? "Refresh diff" : "Show diff"}
        </button>}
        {active && run.runtime === "generation" && <span className="text-text-subtle">Manage this request in the feature that started it.</span>}
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
        <ol className="flex flex-col rounded p-2" style={PRE}>
          {events.map((event, i) => {
            const isNewStep = event.type !== "tool_result" && event.type !== "stderr";
            return (
              <li
                key={event.seq}
                className={`flex items-start gap-2 whitespace-pre-wrap break-words ${eventTone(event)}`}
                style={{
                  paddingLeft: event.type === "tool_result" ? 16 : 0,
                  paddingTop: i > 0 && isNewStep ? 5 : 1,
                  marginTop: i > 0 && isNewStep ? 5 : 0,
                  borderTop: i > 0 && isNewStep ? "1px solid var(--border-muted)" : undefined,
                }}
              >
                <span className="shrink-0 tabular-nums text-text-subtle" style={{ width: 60 }}>
                  {clock(event.ts)}
                </span>
                <span className="min-w-0">{describeAgentEvent(event)}</span>
              </li>
            );
          })}
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
                    className="row-select agent-activity-row w-full flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--bg-elevated)]"
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
