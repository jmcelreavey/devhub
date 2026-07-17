"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Download,
  FileWarning,
  GitBranch,
  GitCommit,
  History,
  Layers,
  Maximize2,
  Minimize2,
  RefreshCw,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import { agentStashConflictCommand, openTerminal } from "@/lib/terminal-launch";
import type { GitHookFailurePayload } from "@/lib/git-hook-failure";
import type { StashConflictPayload } from "@/app/repos/types";
import { BlamePanel } from "./BlamePanel";
import { BranchesPanel } from "./BranchesPanel";
import { ChangesPanel } from "./ChangesPanel";
import { ConflictsPanel } from "./ConflictsPanel";
import { GitHookFailureDialog } from "./GitHookFailureDialog";
import { HistoryPanel } from "./HistoryPanel";
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
];

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
  initialTab = "changes",
}: RepoGitWorkspaceProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const controlled = openControlled !== undefined;
  const open = controlled ? openControlled : openUncontrolled;
  const [tab, setTab] = useState<RepoGitTabId>(initialTab);
  /** When true, History opens focused on unpushed commits (from badge click). */
  const [historyFocusUnpushed, setHistoryFocusUnpushed] = useState(false);
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
  }, [setOpen]);
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
      const result = await postGitAction<{ alreadyUpToDate?: boolean; message?: string }>(
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

  useEffect(() => {
    if (open && !wasOpen.current) {
      setTab(initialTab);
      setHistoryFocusUnpushed(false);
      setFullscreen(readFullscreenPref());
    }
    wasOpen.current = open;
  }, [open, initialTab]);

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
    [tab],
  );

  async function offerAiConflict(conflict: StashConflictPayload) {
    const ok = await confirm({
      title: conflict.branch ? `Switched to ${conflict.branch}, stash conflicts` : "Stash left conflicts",
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
      command: await agentStashConflictCommand({
        repoName,
        branch: conflict.branch,
        conflictFiles: conflict.conflictFiles,
      }),
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
                  {hasUnpushed ? (
                    <button
                      type="button"
                      className="repo-unpushed-badge"
                      onClick={() => {
                        setHistoryFocusUnpushed(true);
                        setTab("history");
                      }}
                      title="View unpushed commits in History"
                    >
                      <Upload size={10} aria-hidden /> {unpushedCount} unpushed
                    </button>
                  ) : null}
                  {(hasUnpushed || pushing) && (
                    <button
                      type="button"
                      className="btn btn-ghost repo-git-header-push"
                      disabled={pushing}
                      onClick={() => void pushRepo()}
                      title={pushing ? "Push in progress…" : `Push ${unpushedCount} commit${unpushedCount === 1 ? "" : "s"}`}
                    >
                      {pushing ? (
                        <RefreshCw size={11} className="animate-spin" aria-hidden />
                      ) : (
                        <Upload size={11} aria-hidden />
                      )}
                      {pushing ? "Pushing…" : `Push ${unpushedCount || ""}`.trim()}
                    </button>
                  )}
                  <div className="repo-git-header-actions">
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
                      focusUnpushed={historyFocusUnpushed}
                      onFocusUnpushedConsumed={() => setHistoryFocusUnpushed(false)}
                    />
                  )}
                  {tab === "conflicts" && (
                    <ConflictsPanel repoName={repoName} repoPath={repoPath} onMutate={onMutate} />
                  )}
                  {tab === "blame" && <BlamePanel repoName={repoName} />}
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
