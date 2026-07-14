"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Edit3, Save, X, FileText, RefreshCw, Download } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import { waitForScriptRun } from "@/lib/wait-for-script-run";
import { formatRelativePastAge } from "@/lib/utils";
import { SyncButton } from "@/components/SyncButton";
import { SkeletonRows } from "@/components/SkeletonRows";

interface PersonaSourceMeta {
  layer: string;
  loadLabel: string;
  syncLabel: string;
  tokenHint: string;
}

interface Target {
  id: string;
  label: string;
  filepath: string;
  resolved: string;
  description: string;
  kind: "source" | "synced";
  exists: boolean;
  modified: number | null;
  tokenEstimate?: number | null;
  meta?: PersonaSourceMeta;
  sourceContent?: string;
  identityExcerpt?: string | null;
  sharedExcerpt?: string | null;
}

interface PersonaTool {
  id: string;
  label: string;
}

interface PersonaSource {
  id: "shared-persona" | "identity";
  label: string;
}

interface PersonaBlockResult {
  tool: string;
  toolLabel: string;
  toolFile: string;
  source: string;
  sourceFile: string;
  toolBlock: string | null;
  sourceContent: string;
  toolExists: boolean;
  sourceExists: boolean;
  inSync: boolean;
}

function relTime(ms: number | null): string {
  if (!ms) return "-";
  return formatRelativePastAge(Date.now() - ms);
}

export function PersonaPanel() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>("shared-persona");
  const [content, setContent] = useState<Record<string, string>>({});
  const [loadingContentId, setLoadingContentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPull, setShowPull] = useState(false);
  const [pullTools, setPullTools] = useState<PersonaTool[]>([]);
  const [pullSources, setPullSources] = useState<PersonaSource[]>([]);
  const [pullTool, setPullTool] = useState<string>("");
  const [pullSource, setPullSource] = useState<string>("");
  const [pullBlock, setPullBlock] = useState<PersonaBlockResult | null>(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullRunning, setPullRunning] = useState(false);
  const [syncedOpen, setSyncedOpen] = useState(false);
  const toast = useToast();

  const loadList = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/persona");
      const data = await r.json();
      setTargets(data.targets);
      const seeded: Record<string, string> = {};
      for (const t of data.targets as Target[]) {
        if (t.kind === "source" && typeof t.sourceContent === "string") {
          seeded[t.id] = t.sourceContent;
        }
      }
      if (Object.keys(seeded).length > 0) {
        setContent((prev) => ({ ...prev, ...seeded }));
      }
    } catch {
      toast.error("Couldn't load persona targets.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/persona");
        const data = await r.json();
        if (cancelled) return;
        setTargets(data.targets);
        const seeded: Record<string, string> = {};
        for (const t of data.targets as Target[]) {
          if (t.kind === "source" && typeof t.sourceContent === "string") {
            seeded[t.id] = t.sourceContent;
          }
        }
        if (Object.keys(seeded).length > 0) {
          setContent((prev) => ({ ...prev, ...seeded }));
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load persona targets.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const loadContent = useCallback(
    async (id: string) => {
      let skip = false;
      setContent((prev) => {
        if (prev[id] !== undefined) skip = true;
        return prev;
      });
      if (skip) return;

      setLoadingContentId(id);
      try {
        const r = await fetch(`/api/persona?id=${encodeURIComponent(id)}`);
        const data = await r.json();
        setContent((prev) => ({ ...prev, [id]: data.content ?? "" }));
      } catch {
        setContent((prev) => ({ ...prev, [id]: "" }));
        toast.error("Couldn't load file.");
      } finally {
        setLoadingContentId((current) => (current === id ? null : current));
      }
    },
    [toast],
  );

  const toggle = useCallback(
    async (id: string) => {
      if (expanded === id) {
        if (editing === id) setEditing(null);
        setExpanded(null);
        return;
      }
      setExpanded(id);
      if (editing && editing !== id) setEditing(null);
      await loadContent(id);
    },
    [expanded, editing, loadContent],
  );

  const startEdit = useCallback(
    (id: string) => {
      setDraft(content[id] ?? "");
      setEditing(id);
    },
    [content],
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft("");
  }, []);

  const save = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        const r = await fetch("/api/persona", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, content: draft }),
        });
        if (!r.ok) throw new Error(await r.text());
        setContent((prev) => ({ ...prev, [id]: draft }));
        setEditing(null);
        toast.success("Saved.");
        loadList();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed.");
      } finally {
        setSaving(false);
      }
    },
    [draft, toast, loadList],
  );

  const fetchPullPreview = useCallback(
    async (tool: string, source: string) => {
      if (!tool || !source) return;
      setPullLoading(true);
      setPullBlock(null);
      try {
        const r = await fetch(
          `/api/persona/local?tool=${encodeURIComponent(tool)}&source=${encodeURIComponent(source)}`,
        );
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? r.statusText);
        }
        const data = (await r.json()) as PersonaBlockResult;
        setPullBlock(data);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't read tool config.");
        setPullBlock(null);
      } finally {
        setPullLoading(false);
      }
    },
    [toast],
  );

  const openPull = useCallback(async () => {
    setShowPull(true);
    setPullBlock(null);
    setPullLoading(true);
    try {
      const r = await fetch("/api/persona/local");
      const data = (await r.json()) as { tools: PersonaTool[]; sources: PersonaSource[] };
      setPullTools(data.tools);
      setPullSources(data.sources);
      const initialTool = pullTool || data.tools[0]?.id || "";
      const initialSource = pullSource || data.sources[0]?.id || "";
      setPullTool(initialTool);
      setPullSource(initialSource);
      if (initialTool && initialSource) {
        await fetchPullPreview(initialTool, initialSource);
      }
    } catch {
      toast.error("Couldn't load persona reverse-sync options.");
    } finally {
      setPullLoading(false);
    }
  }, [toast, pullTool, pullSource, fetchPullPreview]);

  const closePull = useCallback(() => {
    setShowPull(false);
    setPullBlock(null);
    setPullRunning(false);
  }, []);

  const onPullToolChange = useCallback(
    (next: string) => {
      setPullTool(next);
      if (pullSource) void fetchPullPreview(next, pullSource);
    },
    [pullSource, fetchPullPreview],
  );

  const onPullSourceChange = useCallback(
    (next: string) => {
      setPullSource(next);
      if (pullTool) void fetchPullPreview(pullTool, next);
    },
    [pullTool, fetchPullPreview],
  );

  const runPull = useCallback(async () => {
    if (!pullTool || !pullSource) return;
    setPullRunning(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: "collect_local_persona",
          personaTool: pullTool,
          personaSources: [pullSource],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { runId } = (await r.json()) as { runId: string };
      const code = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (code === 0) {
        toast.success(`Pulled ${pullSource} from ${pullTool}.`);
        void loadList();
        setContent({});
        closePull();
      } else {
        toast.error(`Pull exited with code ${code}.`);
        setPullRunning(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pull failed.");
      setPullRunning(false);
    }
  }, [pullTool, pullSource, toast, loadList, closePull]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading persona layers">
        <SkeletonRows count={3} height={48} />
      </div>
    );
  }

  const sources = targets.filter((t) => t.kind === "source");
  const synced = targets.filter((t) => t.kind === "synced");

  return (
    <div className="space-y-3">
      <div
        className="text-xs"
        style={{ color: "var(--text-muted)", lineHeight: 1.5 }}
      >
        Three layers: <strong style={{ color: "var(--text)" }}>L0 identity</strong> (tone, every message),{" "}
        <strong style={{ color: "var(--text)" }}>L1 shared persona</strong> (standards, every session),{" "}
        <strong style={{ color: "var(--text)" }}>L2 deep preferences</strong> (modes on demand via the{" "}
        <code className="font-mono">deep-preferences</code> skill). Edit sources below, then{" "}
        <strong style={{ color: "var(--text)" }}>Sync to all tools</strong> to update Claude, Codex, OpenCode,
        Cursor, and repo <code className="font-mono">AGENTS.md</code>. L2 is not synced.
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={loadList}
          disabled={refreshing}
          className="btn btn-ghost text-xs"
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px" }}
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} aria-hidden /> Refresh
        </button>
        <button
          onClick={() => void openPull()}
          className="btn btn-ghost text-xs"
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px" }}
          title="Pull persona content from a tool's config back into the repo source files"
        >
          <Download size={11} aria-hidden /> Pull from tool…
        </button>
        <SyncButton
          script="sync_native_persona"
          label="Sync to all tools"
          successMessage="Persona synced to Claude, Codex, OpenCode and Cursor."
        />
      </div>

      <div className="space-y-2">
        {sources.map((t) => {
          const isOpen = expanded === t.id;
          const isEditing = editing === t.id;
          return (
            <div key={t.id} className="card" style={{ padding: 0 }}>
              <div className="w-full flex items-center gap-2" style={{ padding: "8px 14px" }}>
                <button
                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                  onClick={() => toggle(t.id)}
                  aria-expanded={isOpen}
                >
                  <FileText size={12} style={{ color: t.kind === "source" ? "var(--accent)" : "var(--text-subtle)", flexShrink: 0 }} aria-hidden />
                  <span className="font-medium text-sm" style={{ color: "var(--text)" }}>
                    {t.label}
                  </span>
                  {t.meta && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        borderRadius: "3px",
                        background: "var(--bg-elevated)",
                        color: "var(--text-subtle)",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {t.meta.layer}
                    </span>
                  )}
                  {t.kind === "source" && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        borderRadius: "3px",
                        background: "var(--accent-dim)",
                        color: "var(--accent)",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      SOURCE
                    </span>
                  )}
                  {t.tokenEstimate != null && t.tokenEstimate > 0 && (
                    <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                      ~{t.tokenEstimate} tok
                    </span>
                  )}
                  {!t.exists && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        borderRadius: "3px",
                        background: "var(--bg-elevated)",
                        color: "var(--text-subtle)",
                        fontWeight: 600,
                      }}
                    >
                      NOT YET WRITTEN
                    </span>
                  )}
                </button>
                <span className="text-xs hidden sm:inline" style={{ color: "var(--text-subtle)" }}>
                  {t.exists ? relTime(t.modified) : ""}
                </span>
                <button
                  onClick={() => toggle(t.id)}
                  className="btn btn-ghost"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                >
                  {isOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              </div>

              {isOpen && (
                <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
                  <p
                    className="text-xs"
                    style={{
                      color: "var(--text-muted)",
                      lineHeight: 1.5,
                      marginBottom: "10px",
                      paddingBottom: "10px",
                      borderBottom: "1px dashed var(--border-muted)",
                    }}
                  >
                    {t.description}
                  </p>
                  {t.meta && (
                    <div
                      className="text-xs space-y-1"
                      style={{
                        color: "var(--text-muted)",
                        marginBottom: "10px",
                        paddingBottom: "10px",
                        borderBottom: "1px dashed var(--border-muted)",
                      }}
                    >
                      <div>
                        <strong style={{ color: "var(--text)" }}>Loads:</strong> {t.meta.loadLabel}
                      </div>
                      <div>
                        <strong style={{ color: "var(--text)" }}>Sync:</strong> {t.meta.syncLabel}
                      </div>
                      <div>
                        <strong style={{ color: "var(--text)" }}>Budget:</strong> {t.meta.tokenHint}
                        {t.tokenEstimate != null && t.tokenEstimate > 0
                          ? ` (measured ~${t.tokenEstimate})`
                          : ""}
                      </div>
                      {t.id === "deep-preferences" && (
                        <div>
                          Mode files: <code className="font-mono">persona/modes/*.md</code> - skill{" "}
                          <code className="font-mono">skills/shared/deep-preferences</code>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px", flexWrap: "wrap" }}>
                    <code className="text-xs" style={{ color: "var(--text-subtle)", fontFamily: '"SFMono-Regular", Consolas, monospace' }}>
                      {t.resolved}
                    </code>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={cancelEdit}
                            className="btn btn-ghost"
                            style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                          >
                            <X size={10} /> Cancel
                          </button>
                          <button
                            onClick={() => save(t.id)}
                            disabled={saving}
                            className="btn btn-primary"
                            style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                          >
                            <Save size={10} /> {saving ? "Saving…" : "Save"}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(t.id)}
                          className="btn btn-ghost"
                          style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                          title={t.description}
                        >
                          <Edit3 size={10} /> Edit
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck={false}
                      style={{
                        width: "100%",
                        minHeight: "320px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "12px",
                        color: "var(--text)",
                        fontSize: "12px",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        lineHeight: 1.5,
                        outline: "none",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <pre
                      className="text-xs overflow-x-auto whitespace-pre-wrap"
                      style={{
                        color: "var(--text-muted)",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        maxHeight: "420px",
                        overflowY: "auto",
                        lineHeight: 1.5,
                        margin: 0,
                      }}
                    >
                      {content[t.id] !== undefined
                        ? content[t.id] || "(empty file)"
                        : loadingContentId === t.id
                          ? "Loading…"
                          : t.exists
                            ? "Loading…"
                            : "(file does not exist yet - saving will create it)"}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <button
          type="button"
          className="w-full flex items-center gap-2 text-left"
          style={{
            padding: "8px 14px",
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
          }}
          onClick={() => setSyncedOpen((o) => !o)}
          aria-expanded={syncedOpen}
        >
          <span className="font-medium text-sm" style={{ color: "var(--text)" }}>
            Synced output (read-only preview)
          </span>
          <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
            {synced.filter((s) => s.exists).length}/{synced.length} present
          </span>
          <span style={{ marginLeft: "auto", color: "var(--text-subtle)" }}>
            {syncedOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </span>
        </button>
        {syncedOpen && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
              Build output from the last sync. Edit sources above, then sync again. Missing files mean
              sync has not run yet on this machine.
            </p>
            <div className="space-y-2">
              {synced.map((s) => (
                <div
                  key={s.id}
                  className="text-xs rounded"
                  style={{
                    padding: "8px 10px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-muted)",
                  }}
                >
                  <div className="font-medium mb-1" style={{ color: "var(--text)" }}>
                    {s.label}
                    {!s.exists && (
                      <span style={{ color: "var(--text-subtle)", fontWeight: 400 }}> - not found</span>
                    )}
                  </div>
                  <code style={{ color: "var(--text-subtle)", fontSize: "10px" }}>{s.resolved}</code>
                  {s.exists && (s.identityExcerpt || s.sharedExcerpt) && (
                    <pre
                      className="mt-2 whitespace-pre-wrap"
                      style={{
                        color: "var(--text-muted)",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        margin: 0,
                        maxHeight: "120px",
                        overflow: "auto",
                      }}
                    >
                      {s.identityExcerpt && `[identity]\n${s.identityExcerpt}\n\n`}
                      {s.sharedExcerpt && `[shared-persona]\n${s.sharedExcerpt}`}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showPull && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pull persona from tool"
          onClick={closePull}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: "min(720px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              padding: "16px 18px",
              background: "var(--bg-elevated)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Pull persona from a tool
              </div>
              <button
                className="btn btn-ghost"
                style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                onClick={closePull}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-xs mb-3" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
              Reads the persona / identity block from the chosen tool&apos;s config and
              overwrites the matching source file in this repo. Use this when you&apos;ve
              edited persona directly inside a tool and want to bring those edits back.
            </p>

            <div className="flex gap-2 flex-wrap mb-3">
              <label className="text-xs flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
                Tool
                <select
                  className="input text-xs"
                  value={pullTool}
                  onChange={(e) => onPullToolChange(e.target.value)}
                  disabled={pullRunning}
                >
                  {pullTools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
                Source
                <select
                  className="input text-xs"
                  value={pullSource}
                  onChange={(e) => onPullSourceChange(e.target.value)}
                  disabled={pullRunning}
                >
                  {pullSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {pullLoading && (
              <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Loading…</p>
            )}
            {!pullLoading && pullBlock && (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  <div>
                    Tool file: <code className="font-mono">{pullBlock.toolFile}</code>
                  </div>
                  <div>
                    Source file: <code className="font-mono">{pullBlock.sourceFile}</code>
                  </div>
                  <div>
                    Status:{" "}
                    {!pullBlock.toolExists
                      ? "tool file missing"
                      : pullBlock.toolBlock === null
                        ? "no markers in tool file"
                        : pullBlock.inSync
                          ? "in sync - pull would do nothing"
                          : "different - pull will overwrite source"}
                  </div>
                </div>

                {pullBlock.toolBlock !== null && (
                  <>
                    <div className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      Tool content (will be written to source):
                    </div>
                    <pre
                      className="text-xs p-2 rounded overflow-auto"
                      style={{
                        background: "var(--bg)",
                        color: "var(--text-muted)",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        maxHeight: "200px",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {pullBlock.toolBlock}
                    </pre>
                    <div className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      Current source content:
                    </div>
                    <pre
                      className="text-xs p-2 rounded overflow-auto"
                      style={{
                        background: "var(--bg)",
                        color: "var(--text-muted)",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        maxHeight: "200px",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {pullBlock.sourceContent || "(empty)"}
                    </pre>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={closePull}
                disabled={pullRunning}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs"
                onClick={() => void runPull()}
                disabled={
                  pullRunning ||
                  !pullBlock ||
                  pullBlock.toolBlock === null ||
                  pullBlock.inSync
                }
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <Download size={11} aria-hidden />
                {pullRunning ? "Pulling…" : "Overwrite source"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
