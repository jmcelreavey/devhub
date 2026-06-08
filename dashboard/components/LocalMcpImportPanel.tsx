"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, Loader2, RefreshCw } from "lucide-react";
import type { LocalMcpImportCandidate } from "@/lib/local-mcp-types";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import { useToast } from "@/lib/use-toast";
import { waitForScriptRun } from "@/lib/wait-for-script-run";

type McpImportTarget = "repo" | "personal";

interface Props {
  onImported?: () => void;
}

export function LocalMcpImportPanel({ onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<LocalMcpImportCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [importTarget, setImportTarget] = useState<McpImportTarget>("personal");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mcp/local");
      const data = (await r.json()) as { candidates?: LocalMcpImportCandidate[] };
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } catch {
      toast.error("Could not scan local MCP configs.");
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, load]);

  const toggle = (name: string) => {
    setSelected((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const importSelected = async () => {
    const names = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (names.length === 0) {
      toast.error("Select at least one server.");
      return;
    }
    setRunning(true);
    setLog([]);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: "collect_local_mcp_servers",
          importServerNames: names,
          importMcpTarget: importTarget,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? r.statusText);
      const { runId } = data as { runId: string };
      const code = await waitForScriptRun(runId, {
        onLine: (line) => setLog((prev) => [...prev, line]),
      });
      revalidateScriptsHistory();
      setSelected({});
      if (code === 0) {
        toast.success(
          importTarget === "personal"
            ? "Saved to personal catalog. Use Sync all tools to push to every client."
            : "Import finished. Review git status if files were staged.",
        );
        void load();
        onImported?.();
      } else {
        toast.error(`Import exited with code ${code}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setRunning(false);
    }
  };

  const importable = candidates.filter((c) => !c.alreadyInCatalog && !c.unsupported);
  const unsupported = candidates.filter((c) => c.unsupported && !c.alreadyInCatalog);
  const toggleOpen = () => setOpen((prev) => !prev);

  return (
    <div className="card mb-3" style={{ padding: "12px 14px", borderColor: "var(--border)" }}>
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between text-left"
        style={{ color: "inherit", cursor: "pointer", padding: 0 }}
        onClick={toggleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleOpen();
          }
        }}
        aria-expanded={open}
      >
        <div>
          <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
            Import from local tools
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)", lineHeight: 1.4 }}>
            Scan ~/.claude.json, ~/.codex/mcp.json, ~/.cursor/mcp.json (and legacy ~/.config/cursor/mcp.json) and
            ~/.config/opencode/opencode.json. Import as <strong>personal</strong> to sync everywhere without git (e.g.
            agentmemory).
          </div>
        </div>
        <span
          className="shrink-0 ml-2 inline-flex items-center justify-center"
          style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
          aria-hidden
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-3" style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="font-medium" style={{ color: "var(--text)" }}>
              Save to:
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="mcp-import-target"
                checked={importTarget === "personal"}
                onChange={() => setImportTarget("personal")}
                disabled={running}
              />
              Personal (~/.config/devhub/mcp-personal/)
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="mcp-import-target"
                checked={importTarget === "repo"}
                onChange={() => setImportTarget("repo")}
                disabled={running}
              />
              Repo (mcp/shared/, git)
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost text-xs"
              style={{ display: "flex", alignItems: "center", gap: "4px" }}
              onClick={() => void load()}
              disabled={loading || running}
            >
              {loading ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />}
              Refresh scan
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs"
              style={{ display: "flex", alignItems: "center", gap: "4px" }}
              onClick={() => void importSelected()}
              disabled={running || importable.length === 0}
            >
              {running ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Download size={12} aria-hidden />}
              Import selected
            </button>
          </div>

          {importable.length === 0 && !loading && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No importable MCP servers found (everything is already in your catalog, or shapes are unsupported).
            </p>
          )}

          <div className="space-y-1 max-h-56 overflow-y-auto">
            {importable.map((c) => {
              const disabled = running;
              const tools = c.sources.map((s) => `${s.tool}${s.remote ? " remote" : ""}`).join(", ");
              return (
                <label
                  key={c.name}
                  className="flex items-start gap-2 text-xs rounded px-2 py-1.5 cursor-pointer"
                  style={{
                    background: "var(--bg-elevated)",
                    opacity: disabled ? 0.55 : 1,
                    cursor: disabled ? "default" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!selected[c.name]}
                    disabled={disabled}
                    onChange={() => !disabled && toggle(c.name)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono font-medium" style={{ color: "var(--text)" }}>
                      {c.name}
                    </span>
                    <span className="block" style={{ color: "var(--text-subtle)", fontSize: "10px" }}>
                      {tools}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {unsupported.length > 0 && (
            <div className="text-xs" style={{ color: "var(--text-subtle)", lineHeight: 1.4 }}>
              <div className="font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Unsupported shape:
              </div>
              <ul className="space-y-0.5">
                {unsupported.map((c) => (
                  <li key={c.name}>
                    <span className="font-mono">{c.name}</span> · {c.sources.map((s) => s.tool).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {log.length > 0 && (
            <pre
              className="text-xs p-2 rounded overflow-y-auto max-h-40"
              style={{
                background: "var(--bg)",
                color: "var(--text-muted)",
                fontFamily: '"SFMono-Regular", Consolas, monospace',
              }}
            >
              {log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
