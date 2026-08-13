"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Check, Play, RefreshCw, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import {
  parseConflictHunks,
  resolveConflictHunk,
  type ConflictChoice,
} from "@/lib/git/conflict-markers";
import { useToast } from "@/lib/hooks/use-toast";
import { agentStashConflictCommand, openTerminal } from "@/lib/terminal-launch";
import { fetchGitJson, postGitAction, repoApi } from "./shared";

interface ConflictItem {
  path: string;
  source: string;
  status?: string;
  content: string | null;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  binary: boolean;
  hasStages: boolean;
}

type ConflictOperation = "merge" | "cherry-pick" | "revert" | "rebase";

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
  const confirm = useConfirm();
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [operation, setOperation] = useState<ConflictOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchGitJson<{
        conflicts: ConflictItem[];
        operation: ConflictOperation | null;
      }>(
        repoApi(repoName, "/git/conflicts"),
      );
      setConflicts(json.conflicts ?? []);
      setOperation(json.operation ?? null);
      setActivePath((prev) =>
        prev && json.conflicts?.some((conflict) => conflict.path === prev)
          ? prev
          : (json.conflicts?.[0]?.path ?? null),
      );
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
  const hunks = useMemo(() => parseConflictHunks(content), [content]);

  function chooseHunk(index: number, choice: ConflictChoice) {
    const hunk = hunks[index];
    if (hunk) setDraft(resolveConflictHunk(content, hunk, choice));
  }

  async function mutateConflict(body: Record<string, unknown>, success: string) {
    setSaving(true);
    try {
      const result = await postGitAction<{ remaining: number }>(
        repoApi(repoName, "/git/conflicts"),
        body,
      );
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      toast.success(success);
      setDraft(null);
      onMutate();
      await refresh();
      if (result.json.remaining === 0) toast.success("All conflicts staged. Continue the operation when ready.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!activePath) return;
    await mutateConflict({ action: "resolve", path: activePath, content }, `Resolved ${activePath}`);
  }

  async function takeSide(side: "base" | "ours" | "theirs") {
    if (!activePath) return;
    await mutateConflict({ action: "take", path: activePath, side }, `Took ${side} for ${activePath}`);
  }

  async function deleteFile() {
    if (!activePath) return;
    const ok = await confirm({
      title: `Delete ${activePath}?`,
      message: "Resolves this conflict by staging the file's deletion.",
      confirmLabel: "Delete & stage",
      variant: "danger",
    });
    if (ok) await mutateConflict({ action: "delete", path: activePath }, `Deleted ${activePath}`);
  }

  async function finish(action: "continue" | "abort") {
    if (!operation) return;
    const ok = await confirm({
      title: `${action === "abort" ? "Abort" : "Continue"} ${operation}?`,
      message:
        action === "abort"
          ? "Git will abandon the in-progress operation and restore the pre-operation state."
          : "Git will continue using the resolutions currently staged.",
      confirmLabel: action === "abort" ? "Abort" : "Continue",
      variant: action === "abort" ? "danger" : "default",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const result = await postGitAction(repoApi(repoName, "/git/conflicts"), { action });
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      toast.success(`${operation} ${action === "abort" ? "aborted" : "continued"}`);
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
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

  return (
    <div className="repo-git-conflicts">
      <div className="repo-git-changes-toolbar">
        {conflicts.length > 0 ? (
          <span className="text-xs text-danger">
            <AlertTriangle size={12} style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
            {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-xs text-success">
            <Check size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> All files staged
          </span>
        )}
        {operation && <span className="repo-git-ref-chip">{operation} in progress</span>}
        <div className="repo-git-spacer" />
        {operation && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving || conflicts.length > 0}
              title={conflicts.length > 0 ? "Resolve every conflict first" : `Continue ${operation}`}
              onClick={() => void finish("continue")}
            >
              <Play size={11} /> Continue
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              data-danger
              disabled={saving}
              onClick={() => void finish("abort")}
            >
              <X size={11} /> Abort
            </button>
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => void handoff()}>
          <Bot size={11} /> AI handoff
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {conflicts.length === 0 ? (
        <div className="repo-git-empty">
          <Check size={20} className="text-success" />
          <div>{operation ? `Ready to continue ${operation}.` : "No unresolved conflicts in this repo."}</div>
          <div style={{ color: "var(--text-subtle)", fontSize: 12 }}>
            {operation
              ? "Review the staged result, then Continue or Abort above."
              : "Conflicts from merges, rebases, cherry-picks and stashes appear here."}
          </div>
        </div>
      ) : (
        <div className="repo-git-conflicts-grid">
          <div className="repo-git-conflict-list">
            {conflicts.map((conflict) => (
              <button
                key={conflict.path}
                type="button"
                className="conflict-path-row"
                data-active={activePath === conflict.path || undefined}
                onClick={() => {
                  setActivePath(conflict.path);
                  setDraft(null);
                }}
              >
                <div className="font-medium truncate">{conflict.path}</div>
                <div style={{ color: "var(--text-subtle)", marginTop: 2 }}>
                  {conflict.status ?? conflict.source}
                  {conflict.binary ? " · binary" : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="repo-git-conflict-editor">
            {active && (
              <>
                <div className="repo-git-conflict-sides">
                  <ConflictSide label="Base" content={active.base} binary={active.binary} />
                  <ConflictSide label="Ours" content={active.ours} binary={active.binary} />
                  <ConflictSide label="Theirs" content={active.theirs} binary={active.binary} />
                </div>
                {operation === "rebase" && (
                  <div className="repo-git-conflict-note">
                    During rebase, ours is the target branch and theirs is the commit being replayed.
                  </div>
                )}
                {active.hasStages && (
                  <div className="repo-git-conflict-whole-actions">
                    <span>Use whole file:</span>
                    <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void takeSide("ours")}>Ours</button>
                    <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void takeSide("theirs")}>Theirs</button>
                    {active.base !== null && (
                      <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void takeSide("base")}>Base</button>
                    )}
                  </div>
                )}
                {!active.binary && hunks.length > 0 && (
                  <div className="repo-git-conflict-hunks">
                    {hunks.map((hunk, index) => (
                      <div key={`${hunk.start}-${hunk.end}`} className="repo-git-conflict-hunk">
                        <span>Conflict {index + 1}</span>
                        <button type="button" className="btn btn-ghost" onClick={() => chooseHunk(index, "ours")}>Take ours</button>
                        <button type="button" className="btn btn-ghost" onClick={() => chooseHunk(index, "theirs")}>Take theirs</button>
                        {hunk.base !== null && (
                          <button type="button" className="btn btn-ghost" onClick={() => chooseHunk(index, "base")}>Take base</button>
                        )}
                        <button type="button" className="btn btn-ghost" onClick={() => chooseHunk(index, "both")}>Keep both</button>
                      </div>
                    ))}
                  </div>
                )}
                {active.binary ? (
                  <div className="repo-git-empty-sm">Binary conflict: choose a whole-file version above, or delete the result.</div>
                ) : (
                  <textarea
                    className="repo-git-conflict-textarea"
                    value={content}
                    spellCheck={false}
                    aria-label={`Resolved content for ${active.path}`}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                )}
                <div className="repo-git-commit-actions repo-git-conflict-footer">
                  {!active.binary && (
                    <button type="button" className="btn btn-primary" disabled={saving || hunks.length > 0} onClick={() => void save()}>
                      {saving ? "Saving…" : hunks.length > 0 ? `Resolve ${hunks.length} remaining` : "Save & stage"}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" data-danger disabled={saving} onClick={() => void deleteFile()}>
                    <Trash2 size={11} /> Delete & stage
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConflictSide({
  label,
  content,
  binary,
}: {
  label: string;
  content: string | null;
  binary: boolean;
}) {
  return (
    <div className="repo-git-conflict-side">
      <div>{label}</div>
      <pre>{content === null ? "(deleted or unavailable)" : binary ? "(binary content)" : content}</pre>
    </div>
  );
}
