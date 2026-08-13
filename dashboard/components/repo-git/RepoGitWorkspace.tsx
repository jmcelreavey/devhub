"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Download,
  FileWarning,
  FolderTree,
  GitBranch,
  GitCommit,
  History,
  Keyboard,
  Layers,
  Maximize2,
  Minimize2,
  RefreshCw,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import { agentGitSyncConflictCommand, agentStashConflictCommand, openTerminal } from "@/lib/terminal-launch";
import type { GitHookFailurePayload } from "@/lib/git/hook-failure";
import type { StashConflictPayload } from "@/app/repos/types";
import { useStoredChoice } from "@/lib/hooks/use-stored-state";
import { BlamePanel } from "./BlamePanel";
import { BranchesPanel } from "./BranchesPanel";
import { ChangesPanel } from "./ChangesPanel";
import { ConflictsPanel } from "./ConflictsPanel";
import { GitHookFailureDialog } from "./GitHookFailureDialog";
import { HistoryPanel } from "./HistoryPanel";
import { ReflogPanel } from "./ReflogPanel";
import { WorktreesPanel } from "./WorktreesPanel";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { StashPanel } from "./StashPanel";
import {
  postGitAction,
  readFullscreenPref,
  repoApi,
  writeFullscreenPref,
  type RepoGitTabId,
} from "./shared";

export type { RepoGitTabId } from "./shared";

const TABS: readonly [RepoGitTabId, string, LucideIcon][] = [
  ["changes", "Changes", Layers],
  ["branches", "Branches", GitBranch],
  ["stash", "Stash", Download],
  ["history", "History", History],
  ["conflicts", "Conflicts", FileWarning],
  ["blame", "Blame", GitCommit],
  ["worktrees", "Worktrees", FolderTree],
  // Last, because it is the tab you reach for when something has gone wrong
  // rather than part of the daily loop.
  ["reflog", "Reflog", Undo2],
];

/** Module-level so the stored-choice validator keeps a stable identity. */
const TAB_IDS: readonly RepoGitTabId[] = TABS.map(([id]) => id);

interface RepoGitWorkspaceProps {
  repoName: string;
  repoPath: string;
  dirtyCount: number;
  unpushedCount: number;
  onMutate: () => void;
  /** Controlled open state — when set, parent owns the modal visibility. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the inline badge / Open Git trigger (e.g. top-bar entry). */
  hideTrigger?: boolean;
  /** Tab selected when the modal opens (controlled or uncontrolled). */
  initialTab?: RepoGitTabId;
}

export function RepoGitWorkspace({
  repoName,
  repoPath,
  dirtyCount,
  unpushedCount,
  onMutate,
  open: openControlled,
  onOpenChange,
  hideTrigger = false,
  initialTab,
}: RepoGitWorkspaceProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const controlled = openControlled !== undefined;
  const open = controlled ? openControlled : openUncontrolled;
  // Reopening lands on the tab you left, unless the caller asked for a specific
  // one (e.g. the conflicts banner).
  const [tab, setTab] = useStoredChoice<RepoGitTabId>("devhub:repo-git:tab", "changes", TAB_IDS);
  /** When true, History opens focused on unpushed commits (from badge click). */
  const [historyFocusUnpushed, setHistoryFocusUnpushed] = useState(false);
  /** Commit to select when Blame hands off to History. */
  const [historyFocusCommit, setHistoryFocusCommit] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Live visible dirty count from ChangesPanel; falls back to parent scan. */
  const [liveVisibleDirty, setLiveVisibleDirty] = useState<number | null>(null);
  const [hookFailure, setHookFailure] = useState<GitHookFailurePayload | null>(null);
  /** Workspace-level push so tab switches never cancel a long pre-push hook. */
  const [pushing, setPushing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Map<RepoGitTabId, HTMLButtonElement>>(new Map());
  const wasOpen = useRef(false);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setOpenUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const displayDirty = liveVisibleDirty ?? dirtyCount;
  const hasDirty = displayDirty > 0;
  const hasUnpushed = unpushedCount > 0;

  const setFullscreenPref = useCallback((next: boolean) => {
    setFullscreen(next);
    writeFullscreenPref(next);
  }, []);

  const openWorkspace = useCallback(() => setOpen(true), [setOpen]);
  const openHistoryUnpushed = useCallback(() => {
    setHistoryFocusUnpushed(true);
    setTab("history");
    setOpen(true);
  }, [setOpen, setTab]);
  const closeWorkspace = useCallback(() => {
    setOpen(false);
    setLiveVisibleDirty(null);
    setHistoryFocusUnpushed(false);
  }, [setOpen]);

  const showHookFailure = useCallback((failure: GitHookFailurePayload) => {
    setHookFailure(failure);
    setOpen(true);
  }, [setOpen]);

  const pushRepo = useCallback(async () => {
    if (pushing) {
      toast.info("Push already in progress…");
      return;
    }
    setPushing(true);
    // Slightly above server GIT_NETWORK_TIMEOUT_MS so the API can return a 504 first.
    const timeoutMs = 310_000;
    try {
      const result = await postGitAction<{
        alreadyUpToDate?: boolean;
        message?: string;
        setUpstream?: boolean;
        branch?: string | null;
      }>(
        repoApi(repoName, "/branches"),
        { action: "push" },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!result.ok) {
        if (result.kind === "hook") {
          showHookFailure(result.hook);
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.conflict.error);
      }
      toast.success(
        result.json.alreadyUpToDate
          ? result.json.message || "Already up to date — nothing to push."
          : result.json.setUpstream && result.json.branch
            ? `Pushed — now tracking origin/${result.json.branch}`
            : "Pushed",
      );
      onMutate();
    } catch (err) {
      const aborted =
        err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
      toast.error(
        aborted
          ? `Push timed out after ${Math.round(timeoutMs / 1000)}s — check network, auth, or a stuck hook.`
          : err instanceof Error
            ? err.message
            : "Push failed",
      );
    } finally {
      setPushing(false);
    }
  }, [pushing, repoName, showHookFailure, toast, onMutate]);

  // "?" opens the cheatsheet — but only when the user isn't typing, otherwise
  // it would swallow question marks in the commit message and search boxes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable) return;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      if (initialTab) setTab(initialTab);
      setHistoryFocusUnpushed(false);
      setFullscreen(readFullscreenPref());
    }
    wasOpen.current = open;
  }, [open, initialTab, setTab]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  /** Roving arrow-key navigation for the tablist (WAI-ARIA tabs pattern). */
  const onTablistKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
        return;
      }
      e.preventDefault();
      const index = TABS.findIndex(([id]) => id === tab);
      const nextIndex =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? TABS.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
      const nextId = TABS[nextIndex]![0];
      setTab(nextId);
      tabRefs.current.get(nextId)?.focus();
    },
    [tab, setTab],
  );

  async function offerAiConflict(conflict: StashConflictPayload) {
    const syncingMain = conflict.action === "sync-main" || conflict.action === "merge-branch";
    const ok = await confirm({
      title:
        conflict.action === "merge-branch"
          ? `Merging ${conflict.syncTarget ?? "branch"} left conflicts`
          : conflict.branch
            ? `Switched to ${conflict.branch}, stash conflicts`
            : "Stash left conflicts",
      message: [
        conflict.error,
        "",
        conflict.conflictFiles.length
          ? `Conflicts: ${conflict.conflictFiles.slice(0, 5).join(", ")}${conflict.conflictFiles.length > 5 ? "…" : ""}`
          : "Check git status for conflicted paths.",
        "",
        "Open the Conflicts tab to edit in-app, or hand off to your agent CLI.",
      ].join("\n"),
      confirmLabel: "Resolve with AI",
      cancelLabel: "Open Conflicts tab",
    });
    setTab("conflicts");
    setOpen(true);
    if (!ok) return;
    openTerminal({
      cwd: repoPath,
      label: `resolve conflicts · ${repoName}`,
      command: syncingMain
        ? await agentGitSyncConflictCommand({ repoName, branch: conflict.branch, conflictFiles: conflict.conflictFiles, syncTarget: conflict.syncTarget ?? "origin/main", stashed: conflict.stashed })
        : await agentStashConflictCommand({ repoName, branch: conflict.branch, conflictFiles: conflict.conflictFiles }),
    });
    toast.info("Resolving conflicts in the terminal.");
  }

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <dialog
            ref={dialogRef}
            className="repo-git-modal-backdrop"
            data-fullscreen={fullscreen || undefined}
            aria-labelledby={titleId}
            onCancel={(e) => {
              e.preventDefault();
              if (hookFailure) return;
              if (fullscreen) {
                setFullscreenPref(false);
                return;
              }
              closeWorkspace();
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeWorkspace();
            }}
          >
            <div
              className="repo-git-modal"
              data-fullscreen={fullscreen || undefined}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="repo-git-modal-header">
                <div className="repo-git-modal-title-block">
                  <h2 id={titleId} className="repo-git-modal-title">
                    <GitBranch size={14} aria-hidden />
                    Git workspace
                  </h2>
                  <p className="repo-git-modal-sub">
                    <span className="font-mono">{repoName}</span>
                    <span className="repo-git-modal-path" title={repoPath}>
                      {repoPath}
                    </span>
                  </p>
                </div>
                <div className="repo-git-modal-badges">
                  <span className={hasDirty ? "badge badge-warning" : "badge badge-success"}>
                    {hasDirty ? `${displayDirty} changed` : "clean"}
                  </span>
                  {(hasUnpushed || pushing) && (
                    <div className="repo-git-header-push-group">
                      <button
                        type="button"
                        className="btn btn-ghost repo-git-header-push"
                        disabled={pushing}
                        onClick={() => void pushRepo()}
                        title={
                          pushing
                            ? "Push in progress…"
                            : `Push ${unpushedCount} commit${unpushedCount === 1 ? "" : "s"} not on upstream (distinct from ahead-of-main)`
                        }
                      >
                        {pushing ? (
                          <RefreshCw size={11} className="animate-spin" aria-hidden />
                        ) : (
                          <Upload size={11} aria-hidden />
                        )}
                        {pushing ? "Pushing…" : `Push ${unpushedCount}`}
                      </button>
                      {!pushing ? (
                        <button
                          type="button"
                          className="btn btn-ghost repo-git-header-unpushed-link"
                          onClick={() => {
                            setHistoryFocusUnpushed(true);
                            setTab("history");
                          }}
                          title="Show unpushed commits in History"
                        >
                          History
                        </button>
                      ) : null}
                    </div>
                  )}
                  <div className="repo-git-header-actions">
                    <button
                      type="button"
                      className="btn btn-ghost repo-git-close"
                      onClick={() => setShortcutsOpen(true)}
                      aria-label="Keyboard shortcuts"
                      title="Keyboard shortcuts (?)"
                    >
                      <Keyboard size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost repo-git-close"
                      onClick={() => setFullscreenPref(!fullscreen)}
                      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      aria-pressed={fullscreen}
                      title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost repo-git-close"
                      onClick={closeWorkspace}
                      aria-label="Close git workspace"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </header>

              <div
                className="repo-git-tabs"
                role="tablist"
                aria-label="Git workspace"
                onKeyDown={onTablistKeyDown}
              >
                {TABS.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    ref={(el) => {
                      if (el) tabRefs.current.set(id, el);
                      else tabRefs.current.delete(id);
                    }}
                    type="button"
                    role="tab"
                    id={`${titleId}-tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={`${titleId}-panel`}
                    tabIndex={tab === id ? 0 : -1}
                    className="repo-git-tab"
                    data-active={tab === id || undefined}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={12} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>

              <div
                className="repo-git-tab-body"
                role="tabpanel"
                id={`${titleId}-panel`}
                aria-labelledby={`${titleId}-tab-${tab}`}
              >
                <div key={tab} className="repo-git-pane-enter">
                  {tab === "changes" && (
                    <ChangesPanel
                      repoName={repoName}
                      repoPath={repoPath}
                      onMutate={onMutate}
                      onConflict={offerAiConflict}
                      onHookFailure={showHookFailure}
                      onVisibleDirtyChange={setLiveVisibleDirty}
                      pushing={pushing}
                      onPush={pushRepo}
                    />
                  )}
                  {tab === "branches" && (
                    <BranchesPanel
                      repoName={repoName}
                      onMutate={onMutate}
                      onConflict={offerAiConflict}
                      onHookFailure={showHookFailure}
                      pushing={pushing}
                      onPush={() => void pushRepo()}
                    />
                  )}
                  {tab === "stash" && (
                    <StashPanel
                      repoName={repoName}
                      repoPath={repoPath}
                      onMutate={onMutate}
                      onConflict={offerAiConflict}
                    />
                  )}
                  {tab === "history" && (
                    <HistoryPanel
                      repoName={repoName}
                      onMutate={onMutate}
                      onConflict={offerAiConflict}
                      onHookFailure={showHookFailure}
                      pushing={pushing}
                      onPush={() => void pushRepo()}
                      focusUnpushed={historyFocusUnpushed}
                      onFocusUnpushedConsumed={() => setHistoryFocusUnpushed(false)}
                      focusCommit={historyFocusCommit}
                      onFocusCommitConsumed={() => setHistoryFocusCommit(null)}
                    />
                  )}
                  {tab === "conflicts" && (
                    <ConflictsPanel repoName={repoName} repoPath={repoPath} onMutate={onMutate} />
                  )}
                  {tab === "blame" && (
                    <BlamePanel
                      repoName={repoName}
                      onOpenInHistory={(hash) => {
                        setHistoryFocusCommit(hash);
                        setTab("history");
                      }}
                    />
                  )}
                  {tab === "worktrees" && (
                    <WorktreesPanel repoName={repoName} onMutate={onMutate} />
                  )}
                  {tab === "reflog" && (
                    <ReflogPanel
                      repoName={repoName}
                      onMutate={onMutate}
                      onOpenCommit={(hash) => {
                        setHistoryFocusCommit(hash);
                        setTab("history");
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </dialog>,
          document.body,
        )
      : null;

  return (
    <div className="repo-git-workspace">
      {!hideTrigger && (
        <div className="repo-git-workspace-trigger">
          <button
            type="button"
            onClick={openWorkspace}
            className={hasDirty ? "badge badge-warning" : "badge badge-success"}
            style={{ cursor: "pointer" }}
            aria-expanded={open}
          >
            {hasDirty ? (
              <>
                <AlertTriangle size={10} /> {displayDirty} changed
              </>
            ) : (
              "clean"
            )}
          </button>
          {hasUnpushed && (
            <button
              type="button"
              onClick={openHistoryUnpushed}
              className="repo-unpushed-badge"
              style={{ cursor: "pointer" }}
              aria-expanded={open}
              title="Open History · unpushed commits"
            >
              <Upload size={10} aria-hidden /> {unpushedCount} unpushed
            </button>
          )}
          {/* Persist Pushing… on the card when the modal is closed mid-push. */}
          {pushing && !open && (
            <button
              type="button"
              className="btn btn-ghost repo-git-header-push"
              disabled
              title="Push in progress…"
            >
              <RefreshCw size={11} className="animate-spin" aria-hidden />
              Pushing…
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost repo-git-open-btn"
            onClick={openWorkspace}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            <GitBranch size={12} /> Open Git
          </button>
        </div>
      )}
      {modal}
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        activeTab={tab}
      />
      {typeof document !== "undefined" &&
        createPortal(
          <GitHookFailureDialog
            failure={hookFailure}
            repoName={repoName}
            repoPath={repoPath}
            onClose={() => setHookFailure(null)}
          />,
          document.body,
        )}
    </div>
  );
}
