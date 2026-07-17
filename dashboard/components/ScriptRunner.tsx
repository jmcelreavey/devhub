"use client";

import { useState, useRef, useEffect } from "react";
import { AlertTriangle, Eye, Play, X } from "lucide-react";
import {
  parseExcludeCsv,
  readExcludedSkillIdsFromStorage,
  readExcludedAgentIdsFromStorage,
  writeExcludedSkillIdsToStorage,
  writeExcludedAgentIdsToStorage,
  AGENTS_SYNC_EXCLUDE_STORAGE_KEY,
  SKILLS_SYNC_EXCLUDE_STORAGE_KEY,
} from "@/lib/skills-sync-exclude-storage";
import { CommitMessageModal, defaultCommitCheckpointMessage } from "@/components/CommitMessageModal";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import { waitForScriptRun } from "@/lib/wait-for-script-run";

interface ScriptMeta {
  id: string;
  label: string;
  description: string;
  mutates: boolean;
  effects: string[];
  /** Resolved when previewing — what the script reports it would do. */
  cmd: string;
}

const SCRIPTS: ScriptMeta[] = [];

interface RunState {
  scriptId: string;
  lines: string[];
  exitCode: number | null;
  done: boolean;
}

export function ScriptRunner({ onDone }: { onDone?: () => void } = {}) {
  const [scripts, setScripts] = useState<ScriptMeta[]>(SCRIPTS);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  /** Comma-separated skill dir names — applied to Sync Skills + Collect Skills only. */
  const [excludeSkillsCsv, setExcludeSkillsCsv] = useState("");
  const [excludeAgentsCsv, setExcludeAgentsCsv] = useState("");
  /** When true, sync_skills/sync_agents remove extras not in the catalog. */
  const [syncPruneSkills, setSyncPruneSkills] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const noScripts = scripts.length === 0;

  useEffect(() => {
    const syncFromStorage = () => {
      const ids = readExcludedSkillIdsFromStorage();
      setExcludeSkillsCsv(ids.join(", "));
      setExcludeAgentsCsv(readExcludedAgentIdsFromStorage().join(", "));
    };
    syncFromStorage();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === SKILLS_SYNC_EXCLUDE_STORAGE_KEY) syncFromStorage();
      if (ev.key === AGENTS_SYNC_EXCLUDE_STORAGE_KEY) syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    fetch("/api/scripts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { catalog?: ScriptMeta[] } | null) => {
        if (Array.isArray(data?.catalog) && data.catalog.length > 0) {
          setScripts(data.catalog);
        }
      })
      .catch(() => {
        // Keep local fallback metadata if the API call fails.
      });
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run?.lines]);

  async function startScript(scriptId: string, opts?: { commitMessage?: string }) {
    let commitMessage: string | undefined;
    if (scriptId === "commit_dirty_push") {
      const raw = opts?.commitMessage?.trim();
      if (!raw) return;
      commitMessage = raw;
    }

    setRunning(scriptId);
    setPreviewing(null);
    setRun({ scriptId, lines: [], exitCode: null, done: false });

    let runId: string;
    try {
      const excludeSkills =
        scriptId === "sync_skills" || scriptId === "collect_local_skills"
          ? parseExcludeCsv(excludeSkillsCsv)
          : undefined;
      const excludeAgents =
        scriptId === "sync_agents" || scriptId === "collect_local_agents"
          ? parseExcludeCsv(excludeAgentsCsv)
          : undefined;
      const body: Record<string, unknown> = { script: scriptId, excludeSkills, excludeAgents };
      if (scriptId === "sync_skills") body.prune = syncPruneSkills;
      if (scriptId === "sync_agents") body.prune = syncPruneSkills;
      if (scriptId === "commit_dirty_push" && commitMessage) body.commitMessage = commitMessage;
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? r.statusText);
      runId = data.runId;
    } catch (e) {
      setRun((prev) => (prev ? { ...prev, lines: [String(e)], exitCode: 1, done: true } : null));
      setRunning(null);
      return;
    }

    const code = await waitForScriptRun(runId, {
      onLine: (line) => {
        setRun((prev) => (prev ? { ...prev, lines: [...prev.lines, line] } : null));
      },
    });
    setRun((prev) => (prev ? { ...prev, exitCode: code, done: true } : null));
    setRunning(null);
    revalidateScriptsHistory();
    onDone?.();
  }

  const previewMeta = previewing ? scripts.find((s) => s.id === previewing) ?? null : null;

  function requestRunFromPreview() {
    if (!previewMeta) return;
    if (previewMeta.id === "commit_dirty_push") {
      setCommitModalOpen(true);
      return;
    }
    void startScript(previewMeta.id);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        <label className="block mb-1 font-medium" style={{ color: "var(--text-subtle)" }}>
          Exclude skills from <span className="font-mono">Sync Skills</span> / <span className="font-mono">Collect Skills</span> (comma-separated)
        </label>
        <p className="mb-1.5" style={{ fontSize: "11px", color: "var(--text-subtle)", lineHeight: 1.4 }}>
          Same list as Library → Skills (eye toggles). Stored in browser <code className="font-mono">localStorage</code> only, not in <code className="font-mono">.env.local</code>.
        </p>
        <input
          className="input w-full font-mono"
          style={{ fontSize: "12px" }}
          placeholder="e.g. my-private-skill, draft-skill"
          value={excludeSkillsCsv}
          onChange={(e) => {
            const v = e.target.value;
            setExcludeSkillsCsv(v);
            writeExcludedSkillIdsToStorage(parseExcludeCsv(v));
          }}
          spellCheck={false}
        />
        <label className="block mt-2 mb-1 font-medium" style={{ color: "var(--text-subtle)" }}>
          Exclude agents from <span className="font-mono">Sync Agents</span> / <span className="font-mono">Collect Agents</span> (comma-separated)
        </label>
        <input
          className="input w-full font-mono"
          style={{ fontSize: "12px" }}
          placeholder="e.g. draft-agent, private-reviewer"
          value={excludeAgentsCsv}
          onChange={(e) => {
            const v = e.target.value;
            setExcludeAgentsCsv(v);
            writeExcludedAgentIdsToStorage(parseExcludeCsv(v));
          }}
          spellCheck={false}
        />
        <label
          className="flex items-start gap-2 mt-2 cursor-pointer"
          style={{ fontSize: "11px", color: "var(--text-subtle)", lineHeight: 1.4 }}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={syncPruneSkills}
            onChange={(e) => setSyncPruneSkills(e.target.checked)}
          />
          <span>
            <strong style={{ color: "var(--text-muted)" }}>Prune</strong> on Sync skills/agents: remove
            tool-dir entries not in the catalog. Off by default: copy/overwrite shared entries only.
          </span>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {noScripts ? null : scripts.map((s) => {
          const isPreviewing = previewing === s.id;
          const isRunning = running === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setPreviewing(isPreviewing ? null : s.id)}
              disabled={running !== null}
              className="text-left rounded-lg border px-4 py-3 transition-colors"
              style={{
                background: isPreviewing || isRunning ? "var(--bg-elevated)" : "var(--bg-surface)",
                borderColor: isPreviewing || isRunning ? "var(--accent)" : "var(--border)",
                opacity: running !== null && running !== s.id ? 0.5 : 1,
                cursor: running !== null ? "not-allowed" : "pointer",
              }}
              aria-expanded={isPreviewing}
            >
              <div className="font-medium text-sm mb-0.5 flex items-center gap-2" style={{ color: "var(--text)" }}>
                {s.label}
                {!s.mutates && (
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 5px",
                      borderRadius: "3px",
                      background: "var(--bg-elevated)",
                      color: "var(--text-subtle)",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Read-only
                  </span>
                )}
                {isRunning && (
                  <span className="text-xs animate-pulse" style={{ color: "var(--accent)" }}>
                    running…
                  </span>
                )}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {s.description}
              </div>
            </button>
          );
        })}
      </div>

      {previewMeta && (
        <div
          className="rounded-lg border p-4 space-y-3"
          style={{
            borderColor: previewMeta.mutates ? "var(--warning)" : "var(--accent)",
            background: "var(--bg-surface)",
          }}
        >
          <div className="flex items-start gap-2">
            {previewMeta.mutates ? (
              <AlertTriangle size={16} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} aria-hidden />
            ) : (
              <Eye size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} aria-hidden />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {previewMeta.mutates ? "Will modify your system" : "Read-only - safe to run"}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {previewMeta.description}
              </div>
            </div>
            <button
              onClick={() => setPreviewing(null)}
              className="btn btn-ghost"
              style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
              aria-label="Close preview"
            >
              <X size={14} aria-hidden />
            </button>
          </div>

          <ul className="text-xs space-y-1" style={{ color: "var(--text-muted)", paddingLeft: 24 }}>
            {previewMeta.effects.map((e, i) => (
              <li key={i} style={{ listStyle: "disc" }}>
                {e}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 pt-1">
            <code
              className="text-xs"
              style={{
                color: "var(--text-subtle)",
                background: "var(--bg)",
                padding: "4px 8px",
                borderRadius: "4px",
                fontFamily: "var(--font-mono)",
              }}
            >
              $ {previewMeta.cmd}
            </code>
            <div className="flex gap-2">
              <button
                onClick={() => setPreviewing(null)}
                className="btn btn-ghost text-xs"
                style={{ padding: "6px 12px" }}
              >
                Cancel
              </button>
              <button
                onClick={requestRunFromPreview}
                disabled={running !== null}
                className="btn btn-primary text-xs"
                style={{
                  padding: "6px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: previewMeta.mutates ? "var(--warning)" : "var(--accent)",
                  borderColor: previewMeta.mutates ? "var(--warning)" : "var(--accent)",
                }}
              >
                <Play size={11} aria-hidden /> Run now
              </button>
            </div>
          </div>
        </div>
      )}

      <CommitMessageModal
        open={commitModalOpen}
        onClose={() => setCommitModalOpen(false)}
        title="Commit & push dirty files"
        description="Stages all changes (git add -A), commits with this message, then pushes to origin on main/master."
        defaultMessage={defaultCommitCheckpointMessage()}
        confirmLabel="Run"
        variant="warning"
        onConfirm={(msg) => {
          setCommitModalOpen(false);
          void startScript("commit_dirty_push", { commitMessage: msg });
        }}
      />

      {run && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <div
            className="flex items-center justify-between px-3 py-2 text-xs border-b"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <span>{scripts.find((s) => s.id === run.scriptId)?.label ?? run.scriptId}</span>
            {run.done && (
              <span style={{ color: run.exitCode === 0 ? "var(--success)" : "var(--danger)" }}>
                Exit {run.exitCode}
              </span>
            )}
          </div>
          <pre
            ref={outputRef}
            className="p-3 text-xs overflow-y-auto"
            style={{
              background: "var(--bg)",
              color: "var(--text-muted)",
              maxHeight: "320px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {run.lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {!run.done && <div className="animate-pulse" style={{ color: "var(--text-subtle)" }}>▌</div>}
          </pre>
        </div>
      )}
    </div>
  );
}
