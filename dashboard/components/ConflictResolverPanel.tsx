"use client";

import { useState } from "react";
import { AlertTriangle, Check, FileWarning, RefreshCw } from "lucide-react";
import { EmptyState, FetchError, LoadingLine } from "@/components";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";

interface ConflictItem {
  path: string;
  source: "unmerged" | "markers";
  status?: string;
  content: string | null;
}

interface ConflictsResponse {
  conflicts: ConflictItem[];
  count: number;
}

export function ConflictResolverPanel() {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useLive<ConflictsResponse>("/api/git/conflicts");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const conflicts = data?.conflicts ?? [];
  const activePath = selectedPath ?? conflicts[0]?.path ?? null;
  const active = conflicts.find((c) => c.path === activePath) ?? null;
  const draft = editedDraft ?? active?.content ?? "";

  function selectConflict(path: string) {
    setSelectedPath(path);
    setEditedDraft(null);
  }

  async function saveSelected() {
    if (!activePath || saving) return;
    setSaving(true);
    try {
      const r = await fetch("/api/git/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activePath, content: draft }),
      });
      const body = (await r.json()) as { error?: string; remaining?: number };
      if (!r.ok) throw new Error(body.error ?? "Save failed.");
      toast.success(`Resolved ${activePath}`);
      setSelectedPath(null);
      setEditedDraft(null);
      await mutate();
      if ((body.remaining ?? 0) === 0) toast.success("All conflicts resolved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingLine message="Checking for merge conflicts…" />;
  if (error) return <FetchError message={error.message} onRetry={() => void mutate()} />;

  if (conflicts.length === 0) {
    return (
      <EmptyState
        icon={<Check size={28} style={{ color: "var(--success)" }} />}
        title="No merge conflicts"
        subtitle="Content sync paths are clean — no unmerged files or conflict markers."
      />
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} style={{ color: "var(--danger)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {conflicts.length} merge conflict{conflicts.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void mutate()}>
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col md:flex-row" style={{ minHeight: 320 }}>
        <div className="md:w-56 shrink-0" style={{ borderRight: "1px solid var(--border)" }}>
          {conflicts.map((c) => (
            <button
              key={c.path}
              type="button"
              onClick={() => selectConflict(c.path)}
              className="w-full text-left px-3 py-2.5 text-xs"
              style={{
                background: activePath === c.path ? "var(--accent-dim)" : "transparent",
                color: activePath === c.path ? "var(--text)" : "var(--text-muted)",
                borderBottom: "1px solid var(--border-muted)",
              }}
            >
              <div className="font-medium truncate">{c.path}</div>
              <div style={{ color: "var(--text-subtle)", marginTop: 2 }}>
                {c.source === "unmerged" ? `git ${c.status ?? "unmerged"}` : "conflict markers"}
              </div>
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {active && (
            <>
              <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ color: "var(--text-subtle)" }}>
                <FileWarning size={12} />
                Edit below — remove all <code>{`<<<<<<<`}</code> markers before saving.
              </div>
              <textarea
                value={draft}
                onChange={(e) => setEditedDraft(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full resize-none font-mono text-xs p-4"
                style={{ minHeight: 260, background: "var(--bg)", color: "var(--text)", border: "none", outline: "none" }}
              />
              <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
                <button type="button" className="btn btn-primary" disabled={saving || !draft.trim()} onClick={() => void saveSelected()}>
                  {saving ? "Saving…" : "Save & stage"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
