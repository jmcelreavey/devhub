"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, Check, RefreshCw } from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { useToast } from "@/lib/use-toast";
import { agentStashConflictCommand, openTerminal } from "@/lib/terminal-launch";
import { fetchGitJson, postGitAction, repoApi } from "./shared";

interface ConflictItem {
  path: string;
  source: string;
  status?: string;
  content: string | null;
}

export function ConflictsPanel({
  repoName,
  repoPath,
  onMutate,
}: {
  repoName: string;
  repoPath: string;
  onMutate: () => void;
}) {
  const toast = useToast();
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchGitJson<{ conflicts: ConflictItem[] }>(
        repoApi(repoName, "/git/conflicts"),
      );
      setConflicts(json.conflicts ?? []);
      setActivePath((prev) => prev ?? json.conflicts?.[0]?.path ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Conflicts failed");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch conflicts on mount / repo change
    void refresh();
  }, [refresh]);

  const active = conflicts.find((c) => c.path === activePath) ?? null;
  const content = draft ?? active?.content ?? "";

  async function save() {
    if (!activePath) return;
    setSaving(true);
    try {
      const result = await postGitAction<{ remaining: number }>(
        repoApi(repoName, "/git/conflicts"),
        { path: activePath, content },
      );
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      toast.success(`Resolved ${activePath}`);
      setDraft(null);
      onMutate();
      await refresh();
      if (result.json.remaining === 0) toast.success("All conflicts resolved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handoff() {
    openTerminal({
      cwd: repoPath,
      label: `resolve conflicts · ${repoName}`,
      command: await agentStashConflictCommand({
        repoName,
        conflictFiles: conflicts.map((c) => c.path),
      }),
    });
  }

  if (loading && conflicts.length === 0) return <SkeletonRows count={4} height={40} />;

  if (conflicts.length === 0) {
    return (
      <div className="repo-git-empty">
        <Check size={20} style={{ color: "var(--success)" }} />
        <div>No unmerged conflicts in this repo.</div>
        <div style={{ color: "var(--text-subtle)", fontSize: 12 }}>
          When stash/checkout leave conflicts, edit them here or hand off to the agent.
        </div>
      </div>
    );
  }

  return (
    <div className="repo-git-conflicts">
      <div className="repo-git-changes-toolbar">
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          <AlertTriangle size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {conflicts.length} conflict
          {conflicts.length === 1 ? "" : "s"}
        </span>
        <div className="repo-git-spacer" />
        <button type="button" className="btn btn-ghost" onClick={() => void handoff()}>
          <Bot size={11} /> AI handoff
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      <div className="repo-git-conflicts-grid">
        <div className="repo-git-conflict-list">
          {conflicts.map((c) => (
            <button
              key={c.path}
              type="button"
              className="conflict-path-row"
              data-active={activePath === c.path || undefined}
              onClick={() => {
                setActivePath(c.path);
                setDraft(null);
              }}
            >
              <div className="font-medium truncate">{c.path}</div>
              <div style={{ color: "var(--text-subtle)", marginTop: 2 }}>{c.status ?? c.source}</div>
            </button>
          ))}
        </div>
        <div className="repo-git-conflict-editor">
          <div className="text-xs px-3 py-2" style={{ color: "var(--text-subtle)", borderBottom: "1px solid var(--border)" }}>
            Remove all <code>{"<<<<<<<"}</code> markers before saving.
          </div>
          <textarea
            className="repo-git-conflict-textarea"
            value={content}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="repo-git-commit-actions" style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-primary" disabled={saving || !content.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : "Save & stage"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
