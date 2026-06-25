"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudUpload } from "lucide-react";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import { useToast } from "@/lib/use-toast";
import { waitForScriptRun } from "@/lib/wait-for-script-run";
import { CommitMessageModal, defaultCommitCheckpointMessage } from "@/components/CommitMessageModal";
import { HoverTip } from "@/components/HoverTip";

interface GitSyncState {
  dirtyCount: number;
  notesCount: number;
  tasksCount: number;
  diagramsCount: number;
  docsCount: number;
  behind: number;
  conflictCount?: number;
}

const EMPTY_GIT_SYNC: GitSyncState = {
  dirtyCount: 0,
  notesCount: 0,
  tasksCount: 0,
  diagramsCount: 0,
  docsCount: 0,
  behind: 0,
};

async function loadGitSyncState(): Promise<GitSyncState> {
  const git = (await fetch("/api/status/git")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as Partial<GitSyncState> | null;

  return {
    ...EMPTY_GIT_SYNC,
    ...git,
  };
}

/**
 * Pending-changes indicator: a one-tap "sync notes/tasks/diagrams" button
 * plus a "commit & push other dirty files" button (with message modal).
 * Self-hides when the working tree is clean.
 *
 * Single source of truth for the content-sync workflow — used by the
 * desktop HubTopBar and the mobile top bar so the two never drift.
 */
export function ContentSyncIndicator() {
  const toast = useToast();
  const [gitDirty, setGitDirty] = useState<GitSyncState>(EMPTY_GIT_SYNC);
  const [cleaning, setCleaning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);

  const contentChanges =
    gitDirty.notesCount +
    gitDirty.tasksCount +
    gitDirty.diagramsCount +
    (gitDirty.docsCount ?? 0);
  const otherDirty = gitDirty.dirtyCount - contentChanges;
  const hasConflicts = (gitDirty.conflictCount ?? 0) > 0;
  const gitActionPending = otherDirty > 0 || gitDirty.behind > 0 || hasConflicts;
  const gitActionBusy = cleaning || updating;

  const gitActionLabel = (() => {
    if (hasConflicts) {
      return `${gitDirty.conflictCount} merge conflict${gitDirty.conflictCount !== 1 ? "s" : ""}. Resolve on Status before syncing.`;
    }
    if (otherDirty > 0 && gitDirty.behind > 0) {
      return `${otherDirty} dirty file${otherDirty !== 1 ? "s" : ""} and ${gitDirty.behind} upstream commit${gitDirty.behind !== 1 ? "s" : ""} waiting. Click to commit & push first.`;
    }
    if (otherDirty > 0) {
      return `${otherDirty} dirty file${otherDirty !== 1 ? "s" : ""}.${cleaning ? " Working…" : " Click to commit & push."}`;
    }
    if (gitDirty.dirtyCount > 0) {
      return `${gitDirty.behind} upstream commit${gitDirty.behind !== 1 ? "s" : ""} waiting. Sync or commit local changes before pulling.`;
    }
    return `${gitDirty.behind} upstream commit${gitDirty.behind !== 1 ? "s" : ""} waiting.${updating ? " Updating…" : " Click to pull and sync."}`;
  })();

  useEffect(() => {
    let cancelled = false;
    const loadGit = async () => {
      const git = await loadGitSyncState();
      if (cancelled) return;
      setGitDirty(git);
    };
    void loadGit();
    const interval = setInterval(() => void loadGit(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function syncNotesTasks() {
    if (contentChanges < 1 || syncing || hasConflicts) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "sync_notes_tasks_push" }),
      });
      if (!r.ok) throw new Error("Could not start sync.");
      const { runId } = (await r.json()) as { runId: string };
      const code = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (code !== 0) {
        toast.error(`Notes sync failed (exit ${code}).`);
        return;
      }
      toast.success("Notes, checklists, tasks, and docs synced.");
      setGitDirty(await loadGitSyncState());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function updateAndSync() {
    if (gitDirty.behind < 1 || updating) return;
    if (gitDirty.dirtyCount > 0) {
      toast.error("Commit or stash local changes before pulling upstream commits.");
      return;
    }

    setUpdating(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "update_and_sync" }),
      });
      if (!r.ok) throw new Error("Could not start Update & Sync.");
      const { runId } = (await r.json()) as { runId: string };
      const code = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (code !== 0) {
        toast.error(`Update & Sync failed (exit ${code}).`);
        return;
      }
      toast.success("Pulled upstream commits and synced.");
      setGitDirty(await loadGitSyncState());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update & Sync failed.");
    } finally {
      setUpdating(false);
    }
  }

  async function commitDirtyWithMessage(message: string) {
    if (otherDirty < 1 || cleaning) return;
    setCleaning(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "commit_dirty_push", commitMessage: message }),
      });
      if (!r.ok) throw new Error("Could not start Commit & Push.");
      const { runId } = (await r.json()) as { runId: string };
      const code = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (code !== 0) {
        toast.error(`Commit & Push failed (exit ${code}).`);
        return;
      }
      toast.success("Committed and pushed dirty files.");
      setGitDirty(await loadGitSyncState());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Commit & Push failed.");
    } finally {
      setCleaning(false);
    }
  }

  function handleGitAction() {
    if (hasConflicts) {
      window.location.href = "/status";
      return;
    }
    if (otherDirty > 0) {
      setCommitModalOpen(true);
      return;
    }
    void updateAndSync();
  }

  if (contentChanges < 1 && otherDirty < 1 && gitDirty.behind < 1 && !hasConflicts) return null;

  return (
    <>
      <span
        role="group"
        className="hub-cluster"
        aria-label="Pending changes"
      >
        {contentChanges > 0 && (
          <HoverTip
            label={`${contentChanges} content change${contentChanges !== 1 ? "s" : ""}.${
              syncing ? " Syncing…" : " Click to sync."
            }`}
            pos="bottom-end"
          >
            <button
              type="button"
              className="hub-icon-btn"
              onClick={() => void syncNotesTasks()}
              aria-label={`Sync ${contentChanges} content changes`}
              style={{ color: "var(--accent)" }}
              disabled={syncing}
            >
              <CloudUpload size={14} aria-hidden className={syncing ? "animate-pulse" : ""} />
            </button>
          </HoverTip>
        )}
        {gitActionPending && (
          <HoverTip
            label={gitActionLabel}
            pos="bottom-end"
          >
            <button
              type="button"
              className="hub-icon-btn"
              onClick={handleGitAction}
              aria-label="Resolve pending git changes"
              style={{ color: "var(--warning)" }}
              disabled={gitActionBusy}
            >
              <AlertTriangle size={14} aria-hidden className={gitActionBusy ? "animate-pulse" : ""} />
            </button>
          </HoverTip>
        )}
      </span>

      <CommitMessageModal
        open={commitModalOpen}
        onClose={() => setCommitModalOpen(false)}
        title="Commit & push dirty files"
        description="Stage all changes, commit, and push to origin."
        defaultMessage={defaultCommitCheckpointMessage()}
        confirmLabel="Commit & push"
        variant="warning"
        fileStats={{
          notes: gitDirty.notesCount,
          tasks: gitDirty.tasksCount,
          diagrams: gitDirty.diagramsCount,
          other: otherDirty,
        }}
        onConfirm={(msg) => {
          setCommitModalOpen(false);
          void commitDirtyWithMessage(msg);
        }}
      />
    </>
  );
}
