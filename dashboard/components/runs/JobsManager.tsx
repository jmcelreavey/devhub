"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlarmClock,
  AlarmClockOff,
  Bot,
  Calendar as CalendarIcon,
  Check,
  Play,
  Power,
  PowerOff,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { formatRelative } from "@/lib/utils";
import {
  installWakeHelper,
  isDesktop,
  loginItemStatus,
  setLoginItem,
  uninstallWakeHelper,
  type LoginItemStatus,
} from "@/lib/desktop/bridge";

interface AgentSpec {
  provider: string;
  prompt: string;
  cwd: string;
}

interface JobWithNext {
  id: string;
  name: string;
  kind: "script" | "agent";
  script?: string;
  agent?: AgentSpec;
  cron: string;
  enabled: boolean;
  wake?: boolean;
  approval?: "pending" | "approved";
  createdAt: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastRunState?: string;
  lastError?: string;
  nextRunAt: number | null;
  scheduleValid: boolean;
}

interface WakeState {
  helper: "ready" | "unavailable" | "unsupported";
  version?: string;
  scheduledAt: number | null;
  error?: string;
}

interface JobsResponse {
  jobs: JobWithNext[];
  scripts: string[];
  providers: Array<{ id: string; label: string; installed: boolean }>;
  wake: WakeState;
}

const PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
  { label: "Daily at 9am", cron: "0 9 * * *" },
  { label: "Mon-Fri 9am", cron: "0 9 * * 1-5" },
];

const EMPTY_FORM = {
  kind: "script" as "script" | "agent",
  name: "",
  script: "",
  provider: "",
  cwd: "",
  prompt: "",
  cron: "0 9 * * *",
  wake: true,
};

const noSubscribe = () => () => {};

function formatAbsolute(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** Every job request from this page is a human acting in DevHub. */
async function jobRequest(url: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify({ ...body, source: "ui" }) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function JobsManager() {
  const { data, mutate, isLoading } = useLive<JobsResponse>("/api/jobs", {
    refreshInterval: 30_000,
  });
  const toast = useToast();
  const confirm = useConfirm();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  // The shell never appears or disappears mid-session; false on the server.
  const desktop = useSyncExternalStore(noSubscribe, isDesktop, () => false);
  const [loginItem, setLoginItemState] = useState<LoginItemStatus | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const scripts = useMemo(() => data?.scripts ?? [], [data]);
  const providers = useMemo(() => (data?.providers ?? []).filter((p) => p.installed), [data]);
  const wakeHelper = data?.wake.helper;

  useEffect(() => {
    void loginItemStatus().then(setLoginItemState);
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>, fallback: string) => {
      try {
        await action();
        mutate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : fallback);
      }
    },
    [mutate, toast],
  );

  const startCreate = useCallback(() => {
    setForm({ ...EMPTY_FORM, script: scripts[0] ?? "", provider: providers[0]?.id ?? "" });
    setCreating(true);
  }, [scripts, providers]);

  const submit = useCallback(async () => {
    if (!form.name.trim() || !form.cron.trim()) return;
    const action =
      form.kind === "script"
        ? { script: form.script }
        : { agent: { provider: form.provider, cwd: form.cwd, prompt: form.prompt } };
    setSubmitting(true);
    try {
      await jobRequest("/api/jobs", "POST", { name: form.name, cron: form.cron, wake: form.wake, ...action });
      setCreating(false);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create job");
    } finally {
      setSubmitting(false);
    }
  }, [form, mutate, toast]);

  const remove = useCallback(
    async (job: JobWithNext) => {
      const ok = await confirm({
        title: `Delete "${job.name}"?`,
        message: "The schedule is removed. Past run history is kept.",
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;
      await run(() => jobRequest(`/api/jobs/${job.id}`, "DELETE"), "Couldn't delete");
    },
    [confirm, run],
  );

  const approve = useCallback(
    async (job: JobWithNext) => {
      const ok = await confirm({
        title: `Approve "${job.name}"?`,
        message: `${job.agent?.provider ?? "The agent"} will run with approvals off in ${job.agent?.cwd ?? "its repo"} on every trigger (${job.cron}):\n\n${job.agent?.prompt ?? ""}`,
        confirmLabel: "Approve",
      });
      if (!ok) return;
      await run(() => jobRequest(`/api/jobs/${job.id}`, "PATCH", { approve: true }), "Couldn't approve");
    },
    [confirm, run],
  );

  const toggleWakeHelper = useCallback(async () => {
    setWakeBusy(true);
    try {
      if (wakeHelper === "ready") await uninstallWakeHelper();
      else await installWakeHelper();
      mutate();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't change the wake helper";
      if (message !== "Cancelled") toast.error(message);
    } finally {
      setWakeBusy(false);
    }
  }, [wakeHelper, mutate, toast]);

  const toggleLoginItem = useCallback(async () => {
    try {
      setLoginItemState(await setLoginItem(loginItem !== "enabled"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change launch at login");
    }
  }, [loginItem, toast]);

  const wake = data?.wake;

  return (
    <section className="card mt-6" aria-label="Scheduled jobs">
      <div className="card-header" style={{ alignItems: "flex-start", gap: "8px" }}>
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="flex items-center gap-1.5">
            <CalendarIcon size={12} aria-hidden /> Scheduled Jobs
          </span>
          <span className="text-[10px] font-normal normal-case" style={{ color: "var(--text-subtle)", fontWeight: 400 }}>
            Run while DevHub is open (closing the window keeps it running); missed runs catch up once. Saved to{" "}
            <code className="font-mono">~/.local/state/devhub/jobs.json</code>.
          </span>
        </span>
        <button
          type="button"
          className="btn btn-ghost shrink-0"
          style={{ fontSize: 12, padding: "3px 8px", marginTop: 2 }}
          onClick={startCreate}
        >
          <Plus size={12} aria-hidden /> New
        </button>
      </div>

      <div className="card-body" style={{ padding: 0 }}>
        {wake && wake.helper !== "unsupported" && (
          <div
            className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle"
            style={{ borderBottom: "1px solid var(--border-muted)" }}
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              {wake.helper === "ready" ? <AlarmClock size={12} aria-hidden /> : <AlarmClockOff size={12} aria-hidden />}
              {wake.helper === "ready"
                ? wake.scheduledAt
                  ? `Wakes this Mac for jobs · next wake ${formatAbsolute(wake.scheduledAt)}`
                  : "Wakes this Mac for jobs · nothing scheduled"
                : desktop
                  ? "Waking is off — jobs wait until the Mac is awake."
                  : "Waking is off — enable it from the DevHub desktop app."}
              {wake.error && <span className="text-danger"> ({wake.error})</span>}
            </span>
            {desktop && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "2px 8px" }}
                onClick={toggleWakeHelper}
                disabled={wakeBusy}
              >
                {wake.helper === "ready" ? "Remove wake helper" : "Enable wake"}
              </button>
            )}
            {loginItem && loginItem !== "unsupported" && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={loginItem === "enabled"} onChange={toggleLoginItem} />
                Open DevHub at login
                {loginItem === "requires-approval" && " (approve in System Settings → Login Items)"}
              </label>
            )}
          </div>
        )}

        {creating && (
          <form
            className="px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-muted)" }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-wrap gap-2 items-center">
              <input
                className="input"
                style={{ flex: "1 1 180px" }}
                placeholder="Job name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
              <select
                className="input"
                style={{ flex: "0 0 110px" }}
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as "script" | "agent" }))}
                aria-label="Job kind"
              >
                <option value="script">Script</option>
                <option value="agent">Agent</option>
              </select>
              {form.kind === "script" ? (
                <select
                  className="input"
                  style={{ flex: "0 0 200px" }}
                  value={form.script}
                  onChange={(e) => setForm((f) => ({ ...f, script: e.target.value }))}
                >
                  <option value="">Pick a script…</option>
                  {scripts.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="input"
                  style={{ flex: "0 0 160px" }}
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  <option value="">Pick an agent…</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="input"
                style={{ flex: "0 0 160px", fontFamily: "var(--font-mono, monospace)" }}
                placeholder="0 9 * * *"
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
                <input
                  type="checkbox"
                  checked={form.wake}
                  onChange={(e) => setForm((f) => ({ ...f, wake: e.target.checked }))}
                />
                Wake Mac
              </label>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
            {form.kind === "agent" && (
              <div className="flex flex-col gap-2 mt-2">
                <input
                  className="input"
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                  placeholder="Repo directory, e.g. ~/Developer/my-repo"
                  value={form.cwd}
                  onChange={(e) => setForm((f) => ({ ...f, cwd: e.target.value }))}
                />
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Self-contained prompt — runs with approvals off on every trigger"
                  value={form.prompt}
                  onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                />
              </div>
            )}
            <div className="flex gap-2 mt-2 text-xs flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "2px 8px" }}
                  onClick={() => setForm((f) => ({ ...f, cron: p.cron }))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </form>
        )}

        {isLoading && !data ? null : jobs.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-text-subtle">
            No scheduled jobs yet. Add one here, or ask an agent to schedule it with the DevHub MCP.
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="px-4 py-3 flex items-start gap-3 text-sm"
              style={{ borderTop: "1px solid var(--border-muted)" }}
            >
              <button
                type="button"
                onClick={() => run(() => jobRequest(`/api/jobs/${job.id}`, "PATCH", { enabled: !job.enabled }), "Couldn't update job")}
                aria-label={job.enabled ? "Disable" : "Enable"}
                className="flex items-center justify-center mt-0.5"
                style={{
                  background: "none",
                  border: "none",
                  color: job.enabled ? "var(--success)" : "var(--text-subtle)",
                  padding: 4,
                }}
              >
                {job.enabled ? <Power size={14} /> : <PowerOff size={14} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words leading-snug" style={{ color: "var(--text)", fontWeight: 500 }}>
                    {job.name}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded shrink-0 break-all"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
                  >
                    {job.kind === "agent" ? (
                      <>
                        <Bot size={11} aria-hidden /> {job.agent?.provider}
                      </>
                    ) : (
                      job.script
                    )}
                  </span>
                  {job.approval === "pending" && (
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--warning)" }}>
                      <AlertCircle size={11} /> waiting for approval
                    </span>
                  )}
                  {!job.scheduleValid && (
                    <span className="inline-flex items-center gap-1 text-xs text-danger">
                      <AlertCircle size={11} /> bad cron
                    </span>
                  )}
                </div>
                {job.agent && (
                  <div className="text-xs mt-0.5 text-text-subtle truncate" title={job.agent.prompt}>
                    <span className="font-mono">{job.agent.cwd}</span> · {job.agent.prompt.split("\n")[0]}
                  </div>
                )}
                <div className="text-xs mt-0.5 text-text-subtle">
                  <span className="font-mono">{job.cron}</span>
                  {" · "}
                  {job.enabled ? (
                    <>
                      next {formatRelative(job.nextRunAt)}
                      <span style={{ marginLeft: 6, opacity: 0.7 }}>({formatAbsolute(job.nextRunAt)})</span>
                    </>
                  ) : (
                    "disabled"
                  )}
                  {job.lastRunAt ? (
                    <>
                      {" · last "}
                      {formatRelative(job.lastRunAt)}
                      {job.lastRunState ? ` (${job.lastRunState})` : ""}
                    </>
                  ) : null}
                </div>
                {job.lastError && <div className="text-xs mt-0.5 text-danger break-words">{job.lastError}</div>}
              </div>
              {job.approval === "pending" && (
                <button
                  type="button"
                  onClick={() => approve(job)}
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: "4px 8px" }}
                >
                  <Check size={12} aria-hidden /> Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => run(() => jobRequest(`/api/jobs/${job.id}`, "PATCH", { wake: !job.wake }), "Couldn't update job")}
                aria-label={job.wake ? "Don't wake the Mac for this job" : "Wake the Mac for this job"}
                title={job.wake ? "Wakes the Mac" : "Doesn't wake the Mac"}
                style={{
                  background: "none",
                  border: "none",
                  color: job.wake ? "var(--text-muted)" : "var(--text-subtle)",
                  padding: 4,
                }}
              >
                {job.wake ? <AlarmClock size={12} aria-hidden /> : <AlarmClockOff size={12} aria-hidden />}
              </button>
              <button
                type="button"
                onClick={() => run(() => jobRequest(`/api/jobs/${job.id}`, "POST"), "Couldn't run job")}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 8px" }}
                title="Run now"
                disabled={job.approval === "pending"}
              >
                <Play size={12} aria-hidden /> Run
              </button>
              <button
                type="button"
                onClick={() => remove(job)}
                aria-label="Delete job"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-subtle)",
                  padding: 4,
                }}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
