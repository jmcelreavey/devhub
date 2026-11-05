"use client";

import Link from "@/lib/navigation";
import type { StashConflictPayload } from "@shared/repos/types";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { launchAgentJob } from "@/lib/agent/job";
import type { GitHookFailurePayload } from "@shared/git/hook-failure";
import { peekUndo,popUndo,type UndoEntry } from "@/lib/git/undo-stack";
import { useStoredChoice,useStoredState } from "@/lib/hooks/use-stored-state";
import { useToast } from "@/lib/hooks/use-toast";
import { subscribeToTaskEvents } from "@/lib/events/task-subscription";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import {
agentGitSyncConflictPrompt,
agentStashConflictPrompt
} from "@/lib/terminal-launch";
import {
AlertTriangle,
ArrowLeft,
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
PanelLeftClose,
PanelLeftOpen,
RefreshCw,
Undo2,
Upload,
X,
type LucideIcon,
} from "lucide-react";
import { useCallback,useEffect,useId,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { BlamePanel } from "./BlamePanel";
import { BranchesPanel } from "./BranchesPanel";
import { ChangesPanel } from "./ChangesPanel";
import { ConflictsPanel } from "./ConflictsPanel";
import { GitHookFailureDialog } from "./GitHookFailureDialog";
import { GitIndexLockDialog } from "./GitIndexLockDialog";
import { GitRail } from "./GitRail";
import { HistoryPanel } from "./HistoryPanel";
import { ReflogPanel } from "./ReflogPanel";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { StashPanel } from "./StashPanel";
import { WorktreesPanel } from "./WorktreesPanel";
import {
fetchGitJson,
gitFailureMessage,
postGitAction,
readFullscreenPref,
repoApi,
writeFullscreenPref,
type BranchesPayload,
type RepoGitTabId,
type StatusPayload,
} from "./shared";

export type { RepoGitTabId } from "./shared";

// History leads: its WIP row stages and commits beside the graph, so it is
// the one view that shows the whole picture (as GitKraken's graph does).
// Conflicts only appears while there are conflicts; the tools (Blame onwards)
// sit apart at the end — occasional lookups, not the daily loop.
const TABS: readonly [RepoGitTabId, string, LucideIcon][] = [
  ["history", "History", History],
  ["changes", "Changes", Layers],
  ["branches", "Branches", GitBranch],
  ["stash", "Stash", Download],
  ["conflicts", "Conflicts", FileWarning],
  ["blame", "Blame", GitCommit],
  ["worktrees", "Worktrees", FolderTree],
  // Last, because it is the tab you reach for when something has gone wrong
  // rather than part of the daily loop.
  ["reflog", "Reflog", Undo2],
];

const TOOL_TABS: ReadonlySet<RepoGitTabId> = new Set(["blame", "worktrees", "reflog"]);

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
  /**
   * `page` = full-route workspace (no dialog). `dialog` (default) is a
   * viewport-sized overlay so Open Git keeps the whole screen.
   */
  variant?: "dialog" | "page";
  /** Tab selected when the modal opens (controlled or uncontrolled). */
  initialTab?: RepoGitTabId;
  /** Select this working-tree path on the Changes tab (hub file click). */
  focusPath?: string | null;
  onFocusPathConsumed?: () => void;
  /** History opens focused on unpushed commits (e.g. ?unpushed=1 on the page). */
  initialFocusUnpushed?: boolean;
  incomingSelectionId?: string | null;
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
  variant = "dialog",
  initialTab,
  focusPath = null,
  onFocusPathConsumed,
  initialFocusUnpushed = false,
  incomingSelectionId = null,
}: RepoGitWorkspaceProps) {
  const page = variant === "page";
  const isMobile = useIsMobile();
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const controlled = openControlled !== undefined;
  const open = page ? true : controlled ? openControlled : openUncontrolled;
  // Reopening lands on the tab you left, unless the caller asked for a specific
  // one (e.g. the conflicts banner).
  const [tab, setTab] = useStoredChoice<RepoGitTabId>("devhub:repo-git:tab", "history", TAB_IDS);
  /** When true, History opens focused on unpushed commits (from badge click). */
  const [historyFocusUnpushed, setHistoryFocusUnpushed] = useState(initialFocusUnpushed);
  /** Commit to select when Blame hands off to History. */
  const [historyFocusCommit, setHistoryFocusCommit] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Live visible dirty count from ChangesPanel; falls back to parent scan. */
  const [liveVisibleDirty, setLiveVisibleDirty] = useState<number | null>(null);
  /**
   * Working-tree + branch summary for the History WIP row, the tab badges, and
   * the left rail. Fetched while the modal is open, refreshed by the same
   * onMutate fan-out the panels use.
   */
  const [summary, setSummary] = useState<{
    staged: number;
    unstaged: number;
    conflicts: number;
    stashes: number;
    currentBranch: string;
    upstream: string | null;
    ahead: number;
    behind: number;
    mainBranch: string | null;
    defaultRemote: string;
    remoteWebUrl: string | null;
    branches: {
      name: string;
      current: boolean;
      upstream?: string | null;
      ahead?: number;
      behind?: number;
      upstreamGone?: boolean;
      pushedElsewhereRef?: string;
      worktreePath?: string;
      staleDays?: number;
    }[];
    remoteBranches: {
      name: string;
      remote: string;
      localName: string;
      trackedLocalName: string | null;
    }[];
    tags: string[];
  } | null>(null);
  const [hookFailure, setHookFailure] = useState<GitHookFailurePayload | null>(null);
  const [indexLock, setIndexLock] = useState<string | null>(null);
  /** Workspace-level push so tab switches never cancel a long pre-push hook. */
  const [pushing, setPushing] = useState(false);
  /** Live network-op progress: last git line and elapsed seconds, so a long op never looks dead. */
  const [pushLine, setPushLine] = useState<string | null>(null);
  const [pushElapsed, setPushElapsed] = useState(0);
  const [pulling, setPulling] = useState(false);
  const netBusy = pushing || pulling;
  /** Latest undoable action (recorded by the panels), shown as a header chip. */
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  const [undoing, setUndoing] = useState(false);
  /**
   * Left rail: resizable (drag the divider) and collapsible. Both persisted.
   * The rail is a convenience column; hiding it must never lose functionality
   * (everything in it is reachable via tabs).
   */
  const [railWidth, setRailWidth] = useStoredState<number>(
    "devhub:repo-git:rail-width",
    196,
    (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 150 && n <= 480 ? n : undefined;
    },
    String,
  );
  const [railOpen, setRailOpen] = useStoredState<boolean>(
    "devhub:repo-git:rail-open",
    true,
    (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
    (v) => (v ? "1" : "0"),
  );

  const startRailDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = railWidth;
      const onMove = (moveEvent: PointerEvent) => {
        setRailWidth(Math.min(480, Math.max(150, startW + moveEvent.clientX - startX)));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("col-resizing");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // Kills text selection and holds the col-resize cursor for the gesture.
      document.body.classList.add("col-resizing");
    },
    [railWidth, setRailWidth],
  );
  const [fullscreen, setFullscreen] = useState(true);
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

  const refreshSummary = useCallback(async () => {
    try {
      const [status, branches] = await Promise.all([
        fetchGitJson<StatusPayload>(repoApi(repoName, "/git/status")),
        fetchGitJson<BranchesPayload>(repoApi(repoName, "/branches")).catch(() => null),
      ]);
      setSummary({
        staged: status.staged.length,
        unstaged: status.unstaged.length,
        conflicts: status.conflictCount,
        stashes: branches?.stashCount ?? 0,
        currentBranch: branches?.currentBranch ?? status.currentBranch,
        upstream: branches?.upstream ?? null,
        ahead: branches?.ahead ?? 0,
        behind: branches?.behind ?? 0,
        mainBranch: branches?.mainBranch ?? null,
        defaultRemote: branches?.remotes?.[0]?.name ?? "origin",
        remoteWebUrl: branches?.remoteWebUrl ?? null,
        branches: (branches?.branches ?? []).map((b) => ({
          name: b.name,
          current: b.current,
          upstream: b.upstream ?? null,
          ahead: b.ahead,
          behind: b.behind,
          upstreamGone: b.upstreamGone,
          pushedElsewhereRef: b.pushedElsewhereRef,
          worktreePath: b.worktreePath,
          staleDays: b.staleDays,
        })),
        remoteBranches: (branches?.remoteBranches ?? []).map((r) => ({
          name: r.name,
          remote: r.remote,
          localName: r.localName,
          trackedLocalName: r.trackedLocalName,
        })),
        tags: branches?.tags ?? [],
      });
    } catch {
      // Summary is decorative — panels surface real errors themselves.
    }
  }, [repoName]);

  useEffect(() => {
    if (!open) return;
    void refreshSummary();
    setUndoEntry(peekUndo(repoName));
  }, [open, refreshSummary, repoName]);

  /**
   * Always auto-fetch when the workspace opens (all repos, no setting).
   *
   * Ahead/behind arrows, staleness and the relation strip are only as honest
   * as the last fetch — a day-old FETCH_HEAD can masquerade as current and
   * send someone chasing phantom pushes. Runs in the background so a slow or
   * offline remote never delays the summary; failures stay silent because an
   * unreachable remote is normal, not an error worth a toast.
   */
  const [fetchStale, setFetchStale] = useState(false);
  const runFetch = useCallback(async () => {
    try {
      const result = await postGitAction(
        repoApi(repoName, "/branches"),
        { action: "fetch" },
        { signal: AbortSignal.timeout(90_000), stream: true },
      );
      // An offline remote is normal, but the arrows are lying while it lasts —
      // say so instead of showing a quiet zero.
      setFetchStale(!result.ok);
      if (result.ok) void refreshSummary();
    } catch {
      setFetchStale(true);
    }
  }, [repoName, refreshSummary]);

  const fetchOnOpenRef = useRef<string | null>(null);
  useEffect(() => {
    // Closing clears the once-per-open guard so reopening fetches again.
    if (!open) {
      fetchOnOpenRef.current = null;
      return;
    }
    if (pushing) return;
    if (fetchOnOpenRef.current === repoName) return;
    fetchOnOpenRef.current = repoName;
    void runFetch();
  }, [open, pushing, repoName, runFetch]);

  const behindCount = summary?.behind ?? 0;
  const displayDirty = liveVisibleDirty ?? dirtyCount;
  const hasDirty = displayDirty > 0;
  const hasUnpushed = unpushedCount > 0;

  /**
   * Bumped on every mutation. History stays mounted across tab switches, so a
   * branch switched from the sidebar (or a commit made on Changes) has to tell
   * it to reload — before, the graph kept showing the old HEAD.
   */
  const [mutationToken, setMutationToken] = useState(0);
  /** Panels' mutate fan-out also refreshes the workspace summary (WIP row, badges, rail). */
  const handleMutate = useCallback(() => {
    onMutate();
    void refreshSummary();
    setUndoEntry(peekUndo(repoName));
    setMutationToken((n) => n + 1);
  }, [onMutate, refreshSummary, repoName]);

  // A fetch/push/checkout from a terminal (or another tab) surfaces here too:
  // the events stream says "this repo's git changed", so reload summary + graph.
  useEffect(() => {
    if (!open) return;
    let timer: number | undefined;
    return subscribeToTaskEvents({
      domains: ["git"],
      repo: repoName,
      cache: {},
      key: `repo-git:${repoName}`,
      connection: () => {},
      refresh: () => {
        if (timer) return;
        timer = window.setTimeout(() => {
          timer = undefined;
          void refreshSummary();
          setMutationToken((n) => n + 1);
        }, 400);
      },
    });
  }, [open, repoName, refreshSummary]);
  /**
   * History is the heavy tab (log, lanes, avatars, scroll position, selection).
   * Once visited it stays mounted and is hidden rather than torn down, so
   * coming back is instant and you land where you left off.
   */
  const [historyMounted, setHistoryMounted] = useState(false);
  if (open && tab === "history" && !historyMounted) setHistoryMounted(true);
  if (!open && historyMounted) setHistoryMounted(false);

  /**
   * One-click undo of the last DevHub-performed action.
   *
   * Soft: `reset --soft HEAD~1` — the commit's changes come back staged.
   * Hard: `commit-action reset-to-commit <headBefore>` — the same endpoint the
   * graph menu uses, which takes a backup branch first.
   */
  const executeUndo = useCallback(async () => {
    const entry = peekUndo(repoName);
    if (!entry || undoing) return;
    const ok = await confirm({
      title: `Undo ${entry.label}?`,
      message:
        entry.kind === "soft"
          ? "git reset --soft HEAD~1 — the commit is removed and its changes come back staged. Does not touch the remote."
          : `Resets the branch to ${entry.headBefore.slice(0, 7)} with a backup branch first. Does not touch the remote.`,
      confirmLabel: "Undo",
      variant: "danger",
    });
    if (!ok) return;
    setUndoing(true);
    try {
      const result =
        entry.kind === "soft"
          ? await postGitAction(repoApi(repoName, "/branches"), { action: "undo-commit" })
          : await postGitAction(repoApi(repoName, "/git/commit-action"), {
              action: "reset-to-commit",
              commit: entry.headBefore,
            });
      if (!result.ok) {
        throw new Error(gitFailureMessage(result));
      }
      popUndo(repoName);
      setUndoEntry(peekUndo(repoName));
      toast.success(`Undid ${entry.label}`);
      handleMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  }, [repoName, undoing, confirm, toast, handleMutate]);

  const setFullscreenPref = useCallback((next: boolean) => {
    setFullscreen(next);
    writeFullscreenPref(next);
  }, []);

  const openWorkspace = useCallback(() => {
    setOpen(true);
  }, [setOpen]);
  const openChanges = useCallback(() => {
    setTab("changes");
    setOpen(true);
  }, [setOpen, setTab]);
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

  const showIndexLock = useCallback((message: string) => {
    setIndexLock(message);
    setOpen(true);
  }, [setOpen]);

  const offerAiConflict = useCallback(async (conflict: StashConflictPayload) => {
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
    if (syncingMain) {
      const opts = {
        repoName,
        branch: conflict.branch,
        conflictFiles: conflict.conflictFiles,
        syncTarget: conflict.syncTarget ?? "origin/main",
        stashed: conflict.stashed,
      };
      await launchAgentJob({
        title: `resolve conflicts · ${repoName}`,
        kind: "agent",
        cwd: repoPath,
        repoName,
        promptText: agentGitSyncConflictPrompt(opts),
        mode: "interactive",
        forceTerminal: true,
        alreadyConfirmed: true,
      });
    } else {
      const opts = {
        repoName,
        branch: conflict.branch,
        conflictFiles: conflict.conflictFiles,
      };
      await launchAgentJob({
        title: `resolve conflicts · ${repoName}`,
        kind: "agent",
        cwd: repoPath,
        repoName,
        promptText: agentStashConflictPrompt(opts),
        mode: "interactive",
        forceTerminal: true,
        alreadyConfirmed: true,
      });
    }
    toast.info("Resolving conflicts in the terminal.");
  }, [confirm, repoName, repoPath, setOpen, setTab, toast]);

  const pushRepo = useCallback(async () => {
    if (pushing) {
      toast.info("Push already in progress…");
      return;
    }
    setPushing(true);
    setPushLine(null);
    setPushElapsed(0);
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
        {
          signal: AbortSignal.timeout(timeoutMs),
          stream: true,
          onProgress: (line) => setPushLine(line),
        },
      );
      if (!result.ok) {
        if (result.kind === "hook") {
          showHookFailure(result.hook);
          return;
        }
        if (result.kind === "index-lock") {
          showIndexLock(result.message);
          return;
        }
        throw new Error(
          result.kind === "error"
            ? result.message
            : result.kind === "conflict"
              ? result.conflict.error
              : result.message,
        );
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
      setPushLine(null);
      setPushElapsed(0);
    }
  }, [pushing, repoName, showHookFailure, showIndexLock, toast, onMutate]);

  const pullRepo = useCallback(async () => {
    if (netBusy) {
      toast.info(pushing ? "Push is still running…" : "Pull already in progress…");
      return;
    }
    setPulling(true);
    setPushLine(null);
    setPushElapsed(0);
    try {
      const result = await postGitAction<{ alreadyUpToDate?: boolean; message?: string }>(
        repoApi(repoName, "/branches"),
        { action: "pull" },
        {
          signal: AbortSignal.timeout(130_000),
          stream: true,
          onProgress: (line) => setPushLine(line),
        },
      );
      if (!result.ok) {
        if (result.kind === "hook") {
          showHookFailure(result.hook);
          return;
        }
        if (result.kind === "index-lock") {
          showIndexLock(result.message);
          return;
        }
        if (result.kind === "conflict") {
          await offerAiConflict(result.conflict);
          return;
        }
        throw new Error(gitFailureMessage(result));
      }
      toast.success(result.json.alreadyUpToDate ? "Already up to date." : "Pulled");
      handleMutate();
    } catch (err) {
      const aborted =
        err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
      toast.error(
        aborted
          ? "Pull timed out — check network, auth, or a stuck hook."
          : err instanceof Error
            ? err.message
            : "Pull failed",
      );
    } finally {
      setPulling(false);
      setPushLine(null);
      setPushElapsed(0);
    }
  }, [netBusy, pushing, repoName, showHookFailure, showIndexLock, offerAiConflict, toast, handleMutate]);

  // Tick while a network op is in flight so the label counts up no matter how quiet git is.
  useEffect(() => {
    if (!netBusy) return;
    const started = Date.now();
    setPushElapsed(0);
    const timer = window.setInterval(() => {
      setPushElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [netBusy]);


  useEffect(() => {
    if (open && !wasOpen.current) {
      if (initialTab) setTab(initialTab);
      setHistoryFocusUnpushed(initialFocusUnpushed);
      setFullscreen(page ? true : readFullscreenPref());
    }
    wasOpen.current = open;
  }, [open, initialTab, initialFocusUnpushed, setTab, page]);

  useEffect(() => {
    if (focusPath) setTab("changes");
  }, [focusPath, setTab]);

  useEffect(() => {
    if (page || !open) return;
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [open, page]);

  useEffect(() => {
    if (page || !open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open, page]);

  // An empty Conflicts tab is noise; it appears the moment a conflict exists.
  const hasConflicts = (summary?.conflicts ?? 0) > 0;
  const visibleTabs = useMemo(
    () => TABS.filter(([id]) => id !== "conflicts" || hasConflicts || tab === "conflicts"),
    [hasConflicts, tab],
  );

  /** Roving arrow-key navigation for the tablist (WAI-ARIA tabs pattern). */
  const onTablistKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
        return;
      }
      e.preventDefault();
      const index = visibleTabs.findIndex(([id]) => id === tab);
      const nextIndex =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? visibleTabs.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
      const nextId = visibleTabs[nextIndex]![0];
      setTab(nextId);
      tabRefs.current.get(nextId)?.focus();
    },
    [tab, setTab, visibleTabs],
  );

  // "?" opens the cheatsheet and modifier+digit jumps to a tab — but never
  // while the user is typing, or they would swallow question marks and numbers
  // in the commit message and search boxes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable) return;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[1-8]$/.test(e.key)) {
        const next = visibleTabs[Number(e.key) - 1];
        if (!next) return;
        e.preventDefault();
        setTab(next[0]);
        return;
      }
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, visibleTabs, setTab]);


  const Title = page ? "h1" : "h2";
  const workspaceShell = (
            <div
              className={page ? "repo-git-modal repo-git-page-shell" : "repo-git-modal"}
              data-fullscreen={(page || fullscreen) || undefined}
              onClick={page ? undefined : (e) => e.stopPropagation()}
              onContextMenu={page ? undefined : (e) => {
                // React portals bubble through the React tree, not the DOM —
                // without this, a right-click anywhere in the modal also opened
                // the repo card's context menu behind it.
                e.stopPropagation();
              }}
            >
              <header className="repo-git-modal-header">
                <div className="repo-git-modal-title-block">
                  <Title id={titleId} className="repo-git-modal-title">
                    <GitBranch size={14} aria-hidden />
                    {page ? `${repoName} · Git` : "Git workspace"}
                  </Title>
                  <p className="repo-git-modal-sub">
                    {page ? (
                      <Link href={`/repos/${encodeURIComponent(repoName)}`} className="repo-git-page-back">
                        <ArrowLeft size={12} aria-hidden /> Repo home
                      </Link>
                    ) : <span className="font-mono">{repoName}</span>}
                    <span className="repo-git-modal-path" title={repoPath}>
                      {repoPath}
                    </span>
                  </p>
                </div>
                <div className="repo-git-modal-badges">
                  {undoEntry && (
                    <button
                      type="button"
                      className="btn btn-ghost repo-git-undo-chip"
                      disabled={undoing}
                      onClick={() => void executeUndo()}
                      title={`Undo ${undoEntry.label}`}
                    >
                      {undoing ? (
                        <RefreshCw size={11} className="animate-spin" aria-hidden />
                      ) : (
                        <Undo2 size={11} aria-hidden />
                      )}
                      Undo {undoEntry.label}
                    </button>
                  )}
                  <span className={hasDirty ? "badge badge-warning" : "badge badge-success"}>
                    {hasDirty ? `${displayDirty} changed` : "clean"}
                  </span>
                  {fetchStale ? (
                    <button
                      type="button"
                      className="badge badge-warning repo-git-stale-refs"
                      title="The last fetch failed — ahead/behind may be stale. Click to retry."
                      onClick={() => void runFetch()}
                    >
                      <AlertTriangle size={10} aria-hidden /> refs may be stale
                    </button>
                  ) : null}
                  <div className="repo-git-header-push-group" role="group" aria-label="Remote operations">
                    <button
                      type="button"
                      className="btn btn-ghost repo-git-header-push"
                      disabled={netBusy}
                      onClick={() => void runFetch()}
                      title="Fetch remote refs so ahead/behind arrows are current"
                    >
                      <Download size={11} aria-hidden /> Fetch
                    </button>
                    {(behindCount > 0 || pulling) && (
                      <button
                        type="button"
                        className="btn btn-ghost repo-git-header-push"
                        disabled={netBusy}
                        onClick={() => void pullRepo()}
                        title={
                          pulling
                            ? `${pushLine ?? "Pull in progress"} — ${pushElapsed}s`
                            : `Pull ${behindCount} commit${behindCount === 1 ? "" : "s"} (fast-forward, autostash)`
                        }
                      >
                        {pulling ? (
                          <RefreshCw size={11} className="animate-spin" aria-hidden />
                        ) : (
                          <Download size={11} aria-hidden />
                        )}
                        {pulling ? `Pulling… ${pushElapsed}s` : `Pull ${behindCount}`}
                      </button>
                    )}
                    {(hasUnpushed || pushing) && (
                      <button
                        type="button"
                        className="btn btn-ghost repo-git-header-push"
                        disabled={netBusy}
                        onClick={() => void pushRepo()}
                        title={
                          pushing
                            ? `${pushLine ?? "Push in progress"} — ${pushElapsed}s`
                            : `Push ${unpushedCount} commit${unpushedCount === 1 ? "" : "s"} not on upstream (distinct from ahead-of-main)`
                        }
                      >
                        {pushing ? (
                          <RefreshCw size={11} className="animate-spin" aria-hidden />
                        ) : (
                          <Upload size={11} aria-hidden />
                        )}
                        {pushing ? `Pushing… ${pushElapsed}s` : `Push ${unpushedCount}`}
                      </button>
                    )}
                    {netBusy ? (
                      <span className="repo-git-push-progress" aria-live="polite">
                        {pushLine ?? "Contacting remote…"}
                      </span>
                    ) : hasUnpushed ? (
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
                    {!page && (
                      <>
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
                      </>
                    )}
                  </div>
                </div>
              </header>

              <div
                className="repo-git-tabs"
                role="tablist"
                aria-label="Git workspace"
                onKeyDown={onTablistKeyDown}
              >
                {visibleTabs.map(([id, label, Icon]) => {
                  const badgeCount =
                    id === "conflicts"
                      ? summary?.conflicts ?? 0
                      : id === "stash"
                        ? summary?.stashes ?? 0
                        : 0;
                  return (
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
                      data-tool={TOOL_TABS.has(id) || undefined}
                      data-active={tab === id || undefined}
                      data-alert={(id === "conflicts" && badgeCount > 0) || undefined}
                      onClick={() => setTab(id)}
                    >
                      <Icon size={12} aria-hidden />
                      {label}
                      {badgeCount > 0 && (
                        <span
                          className={id === "conflicts" ? "repo-git-tab-badge repo-git-tab-badge-alert" : "repo-git-tab-badge"}
                        >
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="repo-git-body">
                {railOpen ? (
                  <>
                    <div className="repo-git-rail-wrap" style={{ width: railWidth }}>
                      <GitRail
                        repoName={repoName}
                        summary={
                          summary
                            ? {
                                currentBranch: summary.currentBranch,
                                upstream: summary.upstream,
                                ahead: summary.ahead,
                                behind: summary.behind,
                                mainBranch: summary.mainBranch,
                                defaultRemote: summary.defaultRemote,
                                remoteWebUrl: summary.remoteWebUrl,
                                stashes: summary.stashes,
                                conflicts: summary.conflicts,
                                staged: summary.staged,
                                unstaged: summary.unstaged,
                                branches: summary.branches,
                                remoteBranches: summary.remoteBranches,
                                tags: summary.tags,
                              }
                            : null
                        }
                        onMutate={handleMutate}
                        onConflict={offerAiConflict}
                        onHookFailure={showHookFailure}
                        onIndexLock={showIndexLock}
                        onOpenTab={setTab}
                        pushing={pushing}
                        onPush={() => void pushRepo()}
                      />
                      <button
                        type="button"
                        className="repo-git-rail-collapse"
                        onClick={() => setRailOpen(false)}
                        title="Hide sidebar — branches, stashes and tags stay available via tabs"
                        aria-expanded={railOpen}
                      >
                        <PanelLeftClose size={12} aria-hidden />
                      </button>
                    </div>
                    <div
                      className="repo-git-rail-handle"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize sidebar"
                      title="Drag to resize · double-click to reset"
                      onPointerDown={startRailDrag}
                      onDoubleClick={() => setRailWidth(196)}
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    className="repo-git-rail-collapsed"
                    onClick={() => setRailOpen(true)}
                    title="Show sidebar (branches, stashes, tags)"
                    aria-expanded={false}
                  >
                    <PanelLeftOpen size={13} aria-hidden />
                    <span className="repo-git-rail-collapsed-label">Branches</span>
                  </button>
                )}
                <div
                  className="repo-git-tab-body"
                  role="tabpanel"
                  id={`${titleId}-panel`}
                  aria-labelledby={`${titleId}-tab-${tab}`}
                >
                {historyMounted && (
                  <div className="repo-git-pane-enter" hidden={tab !== "history"}>
                    <HistoryPanel
                      repoName={repoName}
                      repoPath={repoPath}
                      onMutate={handleMutate}
                      onConflict={offerAiConflict}
                      onHookFailure={showHookFailure}
                      onIndexLock={showIndexLock}
                      pushing={pushing}
                      onPush={() => void pushRepo()}
                      wip={
                        summary
                          ? { staged: summary.staged, unstaged: summary.unstaged }
                          : null
                      }
                      focusUnpushed={historyFocusUnpushed}
                      onFocusUnpushedConsumed={() => setHistoryFocusUnpushed(false)}
                      focusCommit={historyFocusCommit}
                      onFocusCommitConsumed={() => setHistoryFocusCommit(null)}
                      refreshToken={mutationToken}
                    />
                  </div>
                )}
                {tab !== "history" && (
                <div key={tab} className="repo-git-pane-enter">
                  {tab === "changes" && (
                    <ChangesPanel
                      repoName={repoName}
                      repoPath={repoPath}
                      onMutate={handleMutate}
                      onConflict={offerAiConflict}
                      onHookFailure={showHookFailure}
                      onIndexLock={showIndexLock}
                      onVisibleDirtyChange={setLiveVisibleDirty}
                      stacked={page && isMobile}
                      pushing={pushing}
                      onPush={pushRepo}
                      focusPath={focusPath}
                      onFocusPathConsumed={onFocusPathConsumed}
                      incomingSelectionId={incomingSelectionId}
                    />
                  )}
                  {tab === "branches" && (
                    <BranchesPanel
                      repoName={repoName}
                      onMutate={handleMutate}
                      onConflict={offerAiConflict}
                      onHookFailure={showHookFailure}
                      onIndexLock={showIndexLock}
                      pushing={pushing}
                      onPush={() => void pushRepo()}
                    />
                  )}
                  {tab === "stash" && (
                    <StashPanel
                      repoName={repoName}
                      repoPath={repoPath}
                      onMutate={handleMutate}
                      onConflict={offerAiConflict}
                    />
                  )}
                  {tab === "conflicts" && (
                    <ConflictsPanel repoName={repoName} repoPath={repoPath} onMutate={handleMutate} />
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
                    <WorktreesPanel repoName={repoName} onMutate={handleMutate} />
                  )}
                  {tab === "reflog" && (
                    <ReflogPanel
                      repoName={repoName}
                      onMutate={handleMutate}
                      onOpenCommit={(hash) => {
                        setHistoryFocusCommit(hash);
                        setTab("history");
                      }}
                    />
                  )}
                </div>
                )}
                </div>
              </div>
            </div>
  );

  const modal =
    page
      ? (open ? workspaceShell : null)
      : open && typeof document !== "undefined"
        ? createPortal(
            <dialog
              ref={dialogRef}
              className="repo-git-modal-backdrop"
              data-fullscreen={fullscreen || undefined}
              aria-labelledby={titleId}
              onCancel={(e) => {
                e.preventDefault();
                if (hookFailure || indexLock) return;
                closeWorkspace();
              }}
              onClick={(e) => {
                if (e.target === e.currentTarget) closeWorkspace();
              }}
            >
              {workspaceShell}
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
            onClick={openChanges}
            className={hasDirty ? "badge badge-warning" : "badge badge-success"}
            style={{ cursor: "pointer" }}
            title="Open Changes"
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
              title={`${pushLine ?? "Push in progress"} — ${pushElapsed}s`}
            >
              <RefreshCw size={11} className="animate-spin" aria-hidden />
              Pushing… {pushElapsed}s
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost repo-git-open-btn"
            onClick={openWorkspace}
            aria-expanded={open}
            aria-haspopup="dialog"
            title="Open Git"
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
          <>
            <GitHookFailureDialog
              failure={hookFailure}
              repoName={repoName}
              repoPath={repoPath}
              onClose={() => setHookFailure(null)}
            />
            <GitIndexLockDialog
              message={indexLock}
              onClose={() => setIndexLock(null)}
            />
          </>,
          document.body,
        )}
    </div>
  );
}
