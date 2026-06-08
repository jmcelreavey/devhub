"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  Play,
  Power,
  PowerOff,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatRelative } from "@/lib/utils";

interface JobWithNext {
  id: string;
  name: string;
  script: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastExitCode?: number;
  nextRunAt: number | null;
  scheduleValid: boolean;
}

interface JobsResponse {
  jobs: JobWithNext[];
  scripts: string[];
}

const PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
  { label: "Daily at 9am", cron: "0 9 * * *" },
  { label: "Mon–Fri 9am", cron: "0 9 * * 1-5" },
];

function formatAbsolute(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function JobsManager() {
  const { data, mutate, isLoading } = useLive<JobsResponse>("/api/jobs", {
    refreshInterval: 30_000,
  });
  const toast = useToast();
  const confirm = useConfirm();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    script: "",
    cron: "0 9 * * *",
  });
  const [submitting, setSubmitting] = useState(false);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const scripts = useMemo(() => data?.scripts ?? [], [data]);

  const startCreate = useCallback(() => {
    setForm({
      name: "",
      script: scripts[0] ?? "",
      cron: "0 9 * * *",
    });
    setCreating(true);
  }, [scripts]);

  const submit = useCallback(async () => {
    if (!form.name.trim() || !form.script || !form.cron.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create job");
      toast.success(`Scheduled "${form.name}"`);
      setCreating(false);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create job");
    } finally {
      setSubmitting(false);
    }
  }, [form, mutate, toast]);

  const toggle = useCallback(
    async (job: JobWithNext) => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !job.enabled }),
        });
        if (!res.ok) throw new Error("Couldn't update job");
        mutate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't update job");
      }
    },
    [mutate, toast],
  );

  const trigger = useCallback(
    async (job: JobWithNext) => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't run job");
        toast.success(`Started "${job.name}"`);
        mutate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't run job");
      }
    },
    [mutate, toast],
  );

  const remove = useCallback(
    async (job: JobWithNext) => {
      const ok = await confirm({
        title: `Delete "${job.name}"?`,
        message: "The schedule is removed. Past run history is kept.",
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;
      try {
        const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Couldn't delete");
        mutate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't delete");
      }
    },
    [confirm, mutate, toast],
  );

  return (
    <section className="card mt-6" aria-label="Scheduled jobs">
      <div className="card-header" style={{ alignItems: "flex-start", gap: "8px" }}>
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="flex items-center gap-1.5">
            <CalendarIcon size={12} aria-hidden /> Scheduled Jobs
          </span>
          <span className="text-[10px] font-normal normal-case" style={{ color: "var(--text-subtle)", fontWeight: 400 }}>
            In-process while this server runs (not system crontab). Saved to{" "}
            <code className="font-mono">~/.local/state/devhub/jobs.json</code> (not in notes or the repo).
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
              <input
                className="input"
                style={{ flex: "0 0 160px", fontFamily: "var(--font-mono, monospace)" }}
                placeholder="0 9 * * *"
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              />
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </div>
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

        {isLoading && !data ? (
          <div className="px-4 py-3 text-xs" style={{ color: "var(--text-subtle)" }}>
            Loading jobs…
          </div>
        ) : jobs.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-subtle)" }}>
            No scheduled jobs yet. Add one to run scripts automatically while
            DevHub is open.
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
                onClick={() => toggle(job)}
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
                  <span className="min-w-0 break-words leading-snug" style={{ color: "var(--text)", fontWeight: 500 }}>{job.name}</span>
                  <span
                    className="font-mono text-xs px-1.5 py-0.5 rounded shrink-0 break-all"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
                  >
                    {job.script}
                  </span>
                  {!job.scheduleValid && (
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: "var(--danger)" }}
                    >
                      <AlertCircle size={11} /> bad cron
                    </span>
                  )}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-subtle)" }}>
                  <span className="font-mono">{job.cron}</span>
                  {" · "}
                  {job.enabled ? (
                    <>
                      next {formatRelative(job.nextRunAt)}
                      <span style={{ marginLeft: 6, opacity: 0.7 }}>
                        ({formatAbsolute(job.nextRunAt)})
                      </span>
                    </>
                  ) : (
                    "disabled"
                  )}
                  {job.lastRunAt ? (
                    <>
                      {" · last "}
                      {formatRelative(job.lastRunAt)}
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => trigger(job)}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 8px" }}
                title="Run now"
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
