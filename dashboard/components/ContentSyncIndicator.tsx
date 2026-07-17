"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, Loader2, Upload } from "lucide-react";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import {
  detectGitHookFailureFromLog,
  HOOK_FAILURE_LOG_REL,
  type GitHookFailurePayload,
} from "@/lib/git-hook-failure";
import { useToast } from "@/lib/use-toast";
import { waitForScriptRun } from "@/lib/wait-for-script-run";
import { HoverTip } from "@/components/HoverTip";
import { GitHookFailureDialog } from "@/components/repo-git/GitHookFailureDialog";
import {
  RepoGitWorkspace,
  type RepoGitTabId,
} from "@/components/repo-git/RepoGitWorkspace";

interface GitSyncState {
  dirtyCount: number;
  otherDirtyCount?: number;
  notesCount: number;
  tasksCount: number;
  diagramsCount: number;
  docsCount: number;
  ahead: number;
  behind: number;
  conflictCount?: number;
  repoName?: string;
  repoPath?: string;
}

const EMPTY_GIT_SYNC: GitSyncState = {
  dirtyCount: 0,
  otherDirtyCount: 0,
  notesCount: 0,
  tasksCount: 0,
  diagramsCount: 0,
  docsCount: 0,
  ahead: 0,
  behind: 0,
};

/** Map orchestrator stdout lines → short topbar phase labels. */
function syncPhaseFromLine(line: string): string | null {
  const l = line.toLowerCase();
  if (l.includes("staging")) return "Staging…";
  if (l.includes("committing")) return "Committing…";
  if (
    l.includes("pushing to origin") ||
    l.includes("retrying with --set-upstream") ||
    l.includes("publishing branch")
  ) {
    return "Pushing (hooks may take a minute)…";
  }
  if (l.includes("unpushed commit") && l.includes("found")) return "Pushing…";
  if (l.includes("checking for remote") || l.includes("pulling")) return "Updating…";
  return null;
}

function contentChangeCount(git: GitSyncState): number {
  return git.notesCount + git.tasksCount + git.diagramsCount + (git.docsCount ?? 0);
}

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
 * plus a warning control that opens the DevHub Git workspace for non-content
 * dirty files / conflicts (or pulls when only behind).
 * Self-hides when the working tree is clean and fully pushed.
 *
 * Single source of truth for the content-sync workflow — used by the
 * desktop HubTopBar and the mobile top bar so the two never drift.
 */
export function ContentSyncIndicator() {
  const toast = useToast();
  const [gitDirty, setGitDirty] = useState<GitSyncState>(EMPTY_GIT_SYNC);
  const [syncing, setSyncing] = useState(false);
  const [syncPhase, setSyncPhase] = useState("Syncing…");
  const [updating, setUpdating] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitTab, setGitTab] = useState<RepoGitTabId>("changes");
  const [hookFailure, setHookFailure] = useState<GitHookFailurePayload | null>(null);

  const contentChanges = contentChangeCount(gitDirty);
  const otherDirty =
    typeof gitDirty.otherDirtyCount === "number"
      ? gitDirty.otherDirtyCount
      : Math.max(0, gitDirty.dirtyCount - contentChanges);
  const hasConflicts = (gitDirty.conflictCount ?? 0) > 0;
  const hasUnpushed = gitDirty.ahead > 0;
  const gitActionPending = otherDirty > 0 || gitDirty.behind > 0 || hasConflicts;
  const canOpenWorkspace = Boolean(gitDirty.repoName && gitDirty.repoPath);
  // Cloud button: sync dirty content, or retry push when only unpushed commits remain.
  // Stay visible while a push/sync is in flight so phase labels don't vanish mid-hook.
  const showContentAction =
    syncing || contentChanges > 0 || (hasUnpushed && !hasConflicts);

  const gitActionLabel = (() => {
    if (hasConflicts) {
      return `${gitDirty.conflictCount} merge conflict${gitDirty.conflictCount !== 1 ? "s" : ""}. Click to open Git.`;
    }
    if (otherDirty > 0 && gitDirty.behind > 0) {
      return `${otherDirty} changed · ${gitDirty.behind} upstream. Open Git to commit before pulling.`;
    }
    if (otherDirty > 0) {
      return `${otherDirty} changed — open Git`;
    }
    if (gitDirty.dirtyCount > 0) {
      return `${gitDirty.behind} upstream commit${gitDirty.behind !== 1 ? "s" : ""} waiting. Sync content or open Git before pulling.`;
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

  async function runScript(
    script: string,
    onPhase?: (phase: string) => void,
  ): Promise<{ code: number; lines: string[] }> {
    const r = await fetch("/api/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });
    if (!r.ok) throw new Error(`Could not start ${script}.`);
    const { runId } = (await r.json()) as { runId: string };
    const lines: string[] = [];
    const code = await waitForScriptRun(runId, {
      onLine: (line) => {
        lines.push(line);
        const phase = syncPhaseFromLine(line);
        if (phase) onPhase?.(phase);
      },
    });
    // SSE can miss lines on fast failures — pull the persisted run log as backup.
    if (code !== 0 && lines.length < 8) {
      try {
        const logRes = await fetch(`/api/scripts/runs/${runId}`);
        if (logRes.ok) {
          const payload = (await logRes.json()) as { lines?: string[] };
          if (Array.isArray(payload.lines) && payload.lines.length > lines.length) {
            lines.splice(0, lines.length, ...payload.lines);
          }
        }
      } catch {
        /* keep streamed lines */
      }
    }
    revalidateScriptsHistory();
    return { code, lines };
  }

  function offerHookFailureFromLog(lines: string[], phase: "push" | "commit" = "push"): boolean {
    const failure = detectGitHookFailureFromLog(lines.join("\n"), phase);
    if (!failure) return false;
    setHookFailure({
      ...failure,
      logPath: failure.logPath ?? HOOK_FAILURE_LOG_REL,
    });
    return true;
  }

  async function syncNotesTasks() {
    if (contentChanges < 1 || syncing || hasConflicts) return;
    setSyncPhase("Syncing…");
    setSyncing(true);
    try {
      const { code, lines } = await runScript("sync_notes_tasks_push", setSyncPhase);
      const next = await loadGitSyncState();
      setGitDirty(next);
      const nextContent = contentChangeCount(next);
      if (code === 0) {
        toast.success("Notes, checklists, tasks, and docs synced.");
        return;
      }
      // Exit 2 (orchestrator) or content clean + still ahead = commit landed, push did not.
      if (code === 2 || (nextContent === 0 && next.ahead > 0)) {
        if (offerHookFailureFromLog(lines, "push")) return;
        toast.error(
          `Committed locally, but push failed (exit ${code}). ${next.ahead} unpushed commit${next.ahead !== 1 ? "s" : ""} remain.`,
        );
        return;
      }
      if (offerHookFailureFromLog(lines, "push") || offerHookFailureFromLog(lines, "commit")) return;
      toast.error(`Notes sync failed (exit ${code}).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed.");
      setGitDirty(await loadGitSyncState());
    } finally {
      setSyncing(false);
    }
  }

  async function pushUnpushedCommits() {
    if (gitDirty.ahead < 1 || syncing || contentChanges > 0 || hasConflicts) return;
    setSyncPhase("Pushing…");
    setSyncing(true);
    try {
      const { code, lines } = await runScript("push_unpushed_commits", setSyncPhase);
      const next = await loadGitSyncState();
      setGitDirty(next);
      if (code === 0) {
        toast.success("Pushed unpushed commits.");
        return;
      }
      if (offerHookFailureFromLog(lines, "push")) return;
      toast.error(
        next.ahead > 0
          ? `Push failed (exit ${code}). ${next.ahead} unpushed commit${next.ahead !== 1 ? "s" : ""} remain.`
          : `Push failed (exit ${code}).`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Push failed.");
      setGitDirty(await loadGitSyncState());
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
      const { code } = await runScript("update_and_sync");
      setGitDirty(await loadGitSyncState());
      if (code !== 0) {
        toast.error(`Update & Sync failed (exit ${code}).`);
        return;
      }
      toast.success("Pulled upstream commits and synced.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update & Sync failed.");
      setGitDirty(await loadGitSyncState());
    } finally {
      setUpdating(false);
    }
  }

  function openGitWorkspace(tab: RepoGitTabId = "changes") {
    if (!canOpenWorkspace) {
      toast.error("Could not resolve this DevHub checkout for Git.");
      return;
    }
    setGitTab(tab);
    setGitOpen(true);
  }

  function handleGitAction() {
    if (hasConflicts) {
      openGitWorkspace("conflicts");
      return;
    }
    if (otherDirty > 0) {
      openGitWorkspace("changes");
      return;
    }
    void updateAndSync();
  }

  function handleContentAction() {
    if (contentChanges > 0) {
      void syncNotesTasks();
      return;
    }
    void pushUnpushedCommits();
  }

  // Stay mounted while the Git modal / hook dialog is open so a mid-session
  // clean doesn't tear down the portal under the user. Keep visible for
  // unpushed commits too — otherwise a commit+failed-push looks like success.
  // Also stay up while a content sync/push is in flight (long pre-push hooks).
  if (
    !gitOpen &&
    !hookFailure &&
    !syncing &&
    !updating &&
    contentChanges < 1 &&
    otherDirty < 1 &&
    gitDirty.behind < 1 &&
    !hasConflicts &&
    !hasUnpushed
  ) {
    return null;
  }

  const contentActionLabel = (() => {
    if (syncing) return syncPhase;
    if (contentChanges > 0) {
      return `${contentChanges} content change${contentChanges !== 1 ? "s" : ""}. Click to sync.`;
    }
    return `${gitDirty.ahead} unpushed commit${gitDirty.ahead !== 1 ? "s" : ""}. Click to push.`;
  })();

  const contentBusyStyle = syncing
    ? {
        color: "var(--accent)",
        width: "auto" as const,
        minWidth: 28,
        padding: "0 8px",
        gap: 6,
        display: "inline-flex" as const,
        alignItems: "center" as const,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap" as const,
        cursor: "wait" as const,
      }
    : { color: "var(--accent)" };

  return (
    <>
      <span
        role="group"
        className="hub-cluster"
        aria-label="Pending changes"
      >
        {showContentAction && (
          <HoverTip label={contentActionLabel} pos="bottom-end">
            <button
              type="button"
              className="hub-icon-btn"
              onClick={handleContentAction}
              aria-label={
                syncing
                  ? syncPhase
                  : contentChanges > 0
                    ? `Sync ${contentChanges} content changes`
                    : `Push ${gitDirty.ahead} unpushed commits`
              }
              aria-busy={syncing}
              style={contentBusyStyle}
              disabled={syncing}
            >
              {syncing ? (
                <>
                  <Loader2 size={14} aria-hidden className="animate-spin" />
                  <span aria-live="polite">{syncPhase}</span>
                </>
              ) : contentChanges > 0 ? (
                <CloudUpload size={14} aria-hidden />
              ) : (
                <Upload size={14} aria-hidden />
              )}
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
              aria-label={
                updating
                  ? "Updating…"
                  : otherDirty > 0 || hasConflicts
                    ? "Open Git workspace"
                    : "Pull and sync upstream commits"
              }
              aria-busy={updating}
              style={{ color: "var(--warning)" }}
              disabled={updating}
            >
              {updating ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <AlertTriangle size={14} aria-hidden />
              )}
            </button>
          </HoverTip>
        )}
      </span>

      {/* Keep mounted while open even if dirty/ahead briefly flickers after commit —
          otherwise the portal unmounts and the modal feels like it "closed". */}
      {(canOpenWorkspace || gitOpen) && gitDirty.repoName && gitDirty.repoPath && (
        <RepoGitWorkspace
          repoName={gitDirty.repoName}
          repoPath={gitDirty.repoPath}
          dirtyCount={otherDirty}
          unpushedCount={gitDirty.ahead}
          hideTrigger
          open={gitOpen}
          onOpenChange={(next) => {
            setGitOpen(next);
            if (!next) void loadGitSyncState().then(setGitDirty);
          }}
          initialTab={gitTab}
          onMutate={() => {
            void loadGitSyncState().then(setGitDirty);
          }}
        />
      )}

      {canOpenWorkspace && (
        <GitHookFailureDialog
          failure={hookFailure}
          repoName={gitDirty.repoName!}
          repoPath={gitDirty.repoPath!}
          onClose={() => setHookFailure(null)}
        />
      )}
    </>
  );
}
