"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  CloudUpload,
  Copy,
  Eye,
  File,
  Folder,
  GitCommit,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { useStoredFraction } from "@/lib/hooks/use-stored-state";
import { useToast } from "@/lib/hooks/use-toast";
import {
  agentCommitMessageCommand,
  agentCommitMessagePrompt,
  agentDiffSelectionCommand,
  agentDiffSelectionPrompt,
} from "@/lib/terminal-launch";
import { launchAgentJob } from "@/lib/agent-job";
import { isGitNoisePath, isUnmergedFile, looksLikeDirectoryPath, type DiffLine } from "@/lib/repos/git-parsers";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { ContextMenu, useContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { openRepoFileInCursor } from "@/lib/open-in-cursor-client";
import { reviewCommentsStore, useReviewComments, type ReviewComment } from "@/lib/git/review-comments";
import { recordUndo } from "@/lib/git/undo-stack";
import { CouplingHints } from "./CouplingHints";
import { DiffMaximizeModal } from "./DiffMaximizeModal";
import { DiffToolbar, DIFF_CONTEXT_LINES, useDiffViewMode, type DiffContextMode } from "./DiffToolbar";
import { GitDiffView } from "./GitDiffView";
import { RepoFileOpenMenu } from "./RepoFileOpenMenu";
import { RepoSplit } from "./SplitResize";
import { usePointerDrag } from "./usePointerDrag";
import {
  fetchGitJson,
  IconBtn,
  postGitAction,
  readCommitModePref,
  readError,
  repoApi,
  writeCommitModePref,
  type CommitMode,
  type GitPanelHandlers,
  type StatusFile,
  type StatusPayload,
} from "./shared";

interface DiffDirEntry {
  name: string;
  type: "file" | "dir";
}

const isMarkdownPath = (path: string) => /\.(md|mdx)$/i.test(path);

/**
 * Review basket — line comments gathered across files, shipped to the agent in
 * one handoff. Clicking a comment jumps to its file; send goes through the
 * in-dock agent chat so the full note set survives (no PTY length limit).
 */
function ReviewBasket({
  repoName,
  repoPath,
  onJumpTo,
}: {
  repoName: string;
  repoPath: string;
  onJumpTo: (path: string, staged: boolean) => void;
}) {
  const comments = useReviewComments();
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const byFile = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      map.set(c.filePath, [...(map.get(c.filePath) ?? []), c]);
    }
    return map;
  }, [comments]);

  async function sendAll() {
    const detail = [...byFile]
      .map(
        ([path, cs]) =>
          `${path}:\n${cs
            .map((c) => `  \`${c.lineText.slice(0, 90)}\`\n  → ${c.text}`)
            .join("\n")}`,
      )
      .join("\n\n");
    const files = [...byFile.keys()].join(", ");
    const promptText = [
      `Review notes for ${repoName} — ${comments.length} comment${comments.length === 1 ? "" : "s"} across ${byFile.size} file${byFile.size === 1 ? "" : "s"}.`,
      `Work through each note against the current working tree:`,
      detail,
      `Ask if intent is unclear. Do not commit unless asked.`,
    ].join("\n\n");
    await launchAgentJob({
      title: `review · ${repoName}`,
      kind: "agent",
      cwd: repoPath,
      repoName,
      promptText,
      promptCommand: `In ${repoName}, address these review comments on ${files}. Ask if intent is unclear. Do not commit unless asked.`,
      mode: "interactive",
      reason: `${comments.length} review comments on ${byFile.size} files`,
      alreadyConfirmed: true,
    });
    toast.info("Agent chat ready with your review notes.");
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="repo-git-diff-context-btn"
        data-active={open || comments.length > 0 || undefined}
        aria-pressed={open}
        title="Line comments gathered across files — send them all to the agent"
        onClick={() => setOpen((v) => !v)}
      >
        <MessageSquarePlus size={11} aria-hidden /> Review{comments.length > 0 ? ` (${comments.length})` : ""}
      </button>
      {open ? (
        <div className="repo-git-review-pop" role="group" aria-label="Review comments">
          {comments.length === 0 ? (
            <div className="repo-git-review-empty">
              No comments yet. Hover a diff line and hit the comment bubble — notes collect here
              across files until you send them.
            </div>
          ) : (
            <>
              <div className="repo-git-review-list">
                {[...byFile].map(([path, cs]) => (
                  <div key={path} className="repo-git-review-file">
                    <div className="repo-git-review-file-path">{path}</div>
                    {cs.map((c) => (
                      <div key={c.id} className="repo-git-review-item">
                        <button
                          type="button"
                          className="repo-git-review-jump"
                          title="Open this file in the diff"
                          onClick={() => {
                            onJumpTo(c.filePath, c.staged);
                            setOpen(false);
                          }}
                        >
                          <span className="repo-git-review-line">`{c.lineText.slice(0, 56)}`</span>
                          <span className="repo-git-review-text">{c.text}</span>
                        </button>
                        <button
                          type="button"
                          className="repo-git-comment-delete"
                          aria-label="Delete comment"
                          onClick={() => reviewCommentsStore.remove(c.id)}
                        >
                          <X size={10} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="repo-git-review-actions">
                <button type="button" className="btn btn-ghost" onClick={() => reviewCommentsStore.clearAll()}>
                  Clear all
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void sendAll()}>
                  <Bot size={12} aria-hidden /> Send {comments.length} to agent
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function splitNoiseFiles(files: StatusFile[]): { visible: StatusFile[]; noise: StatusFile[] } {  const visible: StatusFile[] = [];
  const noise: StatusFile[] = [];
  for (const f of files) {
    if (isGitNoisePath(f.path)) noise.push(f);
    else visible.push(f);
  }
  return { visible, noise };
}

export function ChangesPanel({
  repoName,
  repoPath,
  onMutate,
  onConflict,
  onHookFailure,
  onVisibleDirtyChange,
  pushing,
  onPush,
  focusPath = null,
  onFocusPathConsumed,
}: GitPanelHandlers & {
  repoName: string;
  repoPath: string;
  onVisibleDirtyChange?: (count: number) => void;
  pushing: boolean;
  onPush: () => Promise<void>;
  focusPath?: string | null;
  onFocusPathConsumed?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [rawDiff, setRawDiff] = useState("");
  const [dirPreview, setDirPreview] = useState<{ entries: DiffDirEntry[]; message?: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [contextMode, setContextMode] = useState<DiffContextMode>("default");
  const [diffView, setDiffView] = useDiffViewMode();
  const [mdPreview, setMdPreview] = useState(false);
  const [listFr, setListFr] = useStoredFraction("devhub:repo-git:changes-list-fr", 0.4);
  const [diffMaximized, setDiffMaximized] = useState(false);
  const closeMaximized = useCallback(() => setDiffMaximized(false), []);
  const [message, setMessage] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // Safe to read localStorage in the initializer: the panel only mounts
  // client-side, after the workspace modal opens.
  const [commitMode, setCommitMode] = useState<CommitMode>(() => readCommitModePref());
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const commitMenuRef = useRef<HTMLDivElement>(null);
  const fileMenu = useContextMenu<{ path: string; staged: boolean }>();

  const isMd = Boolean(selected && isMarkdownPath(selected.path));
  /** New side of the diff, rebuilt for the markdown preview. */
  const mdText = useMemo(() => {
    if (!isMd) return "";
    return diffLines
      .filter((l) => l.type === "ctx" || l.type === "add")
      .map((l) => (/^[+-\s]/.test(l.text) ? l.text.slice(1) : l.text))
      .join("\n");
  }, [isMd, diffLines]);

  useEffect(() => {
    if (!commitMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (commitMenuRef.current?.contains(event.target as Node)) return;
      setCommitMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCommitMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [commitMenuOpen]);

  const setCommitModePref = useCallback((next: CommitMode) => {
    setCommitMode(next);
    writeCommitModePref(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchGitJson<StatusPayload>(repoApi(repoName, "/git/status"));
      setStatus(json);
      const visible = json.files.filter((f) => !isGitNoisePath(f.path));
      onVisibleDirtyChange?.(visible.length);
      setSelected((prev) => {
        // Never keep / auto-select hidden noise paths once visible lists are empty.
        if (prev && visible.some((f) => f.path === prev.path)) return prev;
        const firstUnstaged = visible.find((f) => f.unstaged);
        if (firstUnstaged) return { path: firstUnstaged.path, staged: false };
        const firstStaged = visible.find((f) => f.staged);
        if (firstStaged) return { path: firstStaged.path, staged: true };
        return null;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status failed");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast, onVisibleDirtyChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch status on mount / repo change
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!focusPath || !status) return;
    const visible = status.files.filter((file) => !isGitNoisePath(file.path));
    const match = visible.find((file) => file.path === focusPath);
    if (match) {
      setSelected({ path: match.path, staged: match.unstaged ? false : Boolean(match.staged) }); // eslint-disable-line react-hooks/set-state-in-effect -- hub file click selects this path
    }
    onFocusPathConsumed?.();
  }, [focusPath, status, onFocusPathConsumed]);

  useEffect(() => {
    if (!selected) {
      setDiffLines([]); // eslint-disable-line react-hooks/set-state-in-effect -- clear diff when nothing selected
      setRawDiff("");
      setDirPreview(null);
      return;
    }
    let cancelled = false;
    // Clear immediately so the previous file never lingers under a new header.
    setDiffLines([]);
    setRawDiff("");
    setDirPreview(null);
    setDiffLoading(true);
    void (async () => {
      try {
        const qs = new URLSearchParams({
          path: selected.path,
          staged: selected.staged ? "1" : "0",
        });
        if (contextMode === "full") qs.set("full", "1");
        else qs.set("context", String(DIFF_CONTEXT_LINES[contextMode]));
        const json = await fetchGitJson<{
          kind?: "file" | "directory";
          lines?: DiffLine[];
          raw?: string;
          entries?: DiffDirEntry[];
          message?: string;
        }>(repoApi(repoName, `/git/diff?${qs}`));
        if (cancelled) return;
        if (json.kind === "directory" || looksLikeDirectoryPath(selected.path)) {
          setDirPreview({
            entries: json.entries ?? [],
            message: json.message,
          });
          setDiffLines([]);
          setRawDiff("");
        } else {
          setDirPreview(null);
          setDiffLines(json.lines ?? []);
          setRawDiff(json.raw ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setDiffLines([]);
          setRawDiff("");
          setDirPreview(null);
          toast.error(err instanceof Error ? err.message : "Diff failed");
        }
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, repoName, toast, contextMode]);

  // useCallback because the file context menu memoises on it: as a plain
  // function it was a new identity every render, so that useMemo rebuilt the
  // whole menu on every keystroke and state change.
  const stageAction = useCallback(async function stageAction(
    action: "stage" | "unstage" | "discard",
    path?: string,
    options?: {
      paths?: string[];
      confirmTitle?: string;
      confirmMessage?: string;
      successLabel?: string;
      /** Required for discard: which side to wipe. */
      scope?: "staged" | "unstaged";
    },
  ) {
    const paths = options?.paths ?? (path ? [path] : []);
    if (action === "discard" && paths.length > 0) {
      const scope = options?.scope ?? "unstaged";
      const ok = await confirm({
        title: options?.confirmTitle ?? `Discard ${scope} changes in ${paths[0]}?`,
        message:
          options?.confirmMessage ??
          (scope === "staged"
            ? "Discards staged hunks only — unstaged edits in the same file are kept. Cannot be undone."
            : "Discards unstaged worktree changes (keeps anything still staged). Cannot be undone."),
        confirmLabel: "Discard",
        variant: "danger",
      });
      if (!ok) return;
    }
    setActing(`${action}:${paths.join(",") || "all"}`);
    try {
      const payload: Record<string, unknown> =
        paths.length === 1
          ? { action, path: paths[0] }
          : paths.length > 1
            ? { action, paths }
            : { action };
      if (action === "discard") payload.scope = options?.scope ?? "unstaged";
      const result = await postGitAction(repoApi(repoName, "/git/stage"), payload);
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      toast.success(
        options?.successLabel ??
          (action === "stage" ? "Staged" : action === "unstage" ? "Unstaged" : "Discarded"),
      );
      if (action === "discard") {
        const discarded = new Set(paths);
        if (!selected || discarded.has(selected.path)) {
          setSelected(null);
          setDiffLines([]);
          setRawDiff("");
          setDirPreview(null);
        }
      }
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }, [confirm, onMutate, refresh, repoName, selected, toast]);

  async function discardAllVisible(kind: "staged" | "unstaged", files: StatusFile[]) {
    const paths = files.map((f) => f.path);
    if (paths.length === 0) return;
    const n = paths.length;
    await stageAction("discard", undefined, {
      paths,
      scope: kind,
      confirmTitle:
        kind === "staged" ? "Discard all staged changes?" : "Discard all unstaged changes?",
      confirmMessage:
        kind === "staged"
          ? `Discards staged hunks in ${n} file${n === 1 ? "" : "s"} (unstaged edits kept). Cannot be undone.`
          : `Discards unstaged changes in ${n} file${n === 1 ? "" : "s"} (staged hunks kept). Cannot be undone.`,
      successLabel: kind === "staged" ? "Discarded staged" : "Discarded unstaged",
    });
  }

  async function cleanJunkFiles(noisePaths: string[]) {
    if (noisePaths.length === 0) return;
    await stageAction("discard", undefined, {
      paths: noisePaths,
      scope: "unstaged",
      confirmTitle: `Clean ${noisePaths.length} junk file${noisePaths.length === 1 ? "" : "s"}?`,
      confirmMessage: "Removes .DS_Store / cache clutter from the working tree. Cannot be undone.",
      successLabel: "Junk cleaned",
    });
  }

  async function hunkAction(opts: { hunkIndex: number; lineIndexes?: number[] }) {
    if (!selected || !rawDiff) return;
    const action = selected.staged ? "unstage-hunk" : "stage-hunk";
    setActing(`hunk:${selected.path}`);
    try {
      const result = await postGitAction(repoApi(repoName, "/git/stage"), {
        action,
        path: selected.path,
        rawDiff,
        hunkIndex: opts.hunkIndex,
        lineIndexes: opts.lineIndexes,
      });
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      const count = opts.lineIndexes?.length ?? 0;
      const what = count > 0 ? `${count} line${count === 1 ? "" : "s"}` : "hunk";
      toast.success(selected.staged ? `Unstaged ${what}` : `Staged ${what}`);
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Hunk action failed");
    } finally {
      setActing(null);
    }
  }

  async function sendSelectionToAi(snippet: string, lineHint: string) {
    if (!selected) return;
    const context = await prompt({
      title: "Send selection to AI",
      message: `Add context for the agent about ${selected.path} (${lineHint}). Leave blank to continue.`,
      input: { placeholder: "What should the agent do with this?" },
      confirmLabel: "Open agent",
    });
    if (context === null) return;
    const opts = {
      repoName,
      filePath: selected.path,
      snippet,
      lineHint,
      context: context.trim() || undefined,
      staged: selected.staged,
    };
    // Interactive selection handoff — dedicated Agent tab via confirm/inject.
    // OpenCode HTTP oneshot is a poor fit for "discuss this hunk".
    await launchAgentJob({
      title: `diff · ${repoName}`,
      kind: "agent",
      cwd: repoPath,
      repoName,
      promptText: agentDiffSelectionPrompt(opts),
      promptCommand: await agentDiffSelectionCommand(opts),
      mode: "interactive",
      forceTerminal: true,
      reason: `Diff selection in ${selected.path}`,
      alreadyConfirmed: true,
    });
    toast.info("Agent tab ready — chat in the terminal.");
  }

  /**
   * Run a branches-endpoint action (commit / amend / undo-commit). When
   * `andPush` is set, chains the workspace-level push after a successful
   * commit so tab switches never cancel it.
   */
  async function commitAction(extra: Record<string, unknown>, opts?: { andPush?: boolean }) {
    const action = typeof extra.action === "string" ? extra.action : "commit";
    setActing(action);
    try {
      const result = await postGitAction<{ headBefore?: string | null }>(
        repoApi(repoName, "/branches"),
        { action, ...extra },
      );
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          onMutate();
          await refresh();
          return;
        }
        if (result.kind === "hook") {
          onHookFailure(result.hook);
          return;
        }
        throw new Error(result.message);
      }
      toast.success(
        action === "undo-commit" ? "Undid last commit (soft)" : extra.amend ? "Amended" : "Committed",
      );
      // A plain commit is undoable from the header chip — soft reset brings the
      // changes back staged. Amend rewrites in place; no honest one-click undo.
      if (action === "commit" && !extra.amend && result.json.headBefore) {
        recordUndo(repoName, {
          id: `commit:${result.json.headBefore}`,
          label: `commit "${(typeof extra.message === "string" ? extra.message : "").split("\n")[0]?.slice(0, 48)}"`,
          headBefore: result.json.headBefore,
          kind: "soft",
        });
      }
      // Stay on Changes after commit/amend — modal stays open so header Push is usable.
      if (action === "commit") setMessage("");
      onMutate();
      await refresh();
      if (opts?.andPush) {
        setActing(null);
        await onPush();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  async function undoLastCommit() {
    const ok = await confirm({
      title: "Undo last commit?",
      message:
        "Soft reset (git reset --soft HEAD~1). Changes stay staged. Does not touch the remote.",
      confirmLabel: "Undo",
      variant: "danger",
    });
    if (!ok) return;
    await commitAction({ action: "undo-commit" });
  }

  async function commitWithMode(mode: CommitMode) {
    setCommitMenuOpen(false);
    setCommitModePref(mode);
    const trimmed = message.trim();
    if (!trimmed || acting !== null || pushing) return;
    await commitAction(
      { action: "commit", message: trimmed },
      { andPush: mode === "commit-and-push" },
    );
  }

  async function suggestMessage() {
    setAiBusy(true);
    try {
      const res = await fetch(repoApi(repoName, "/git/commit-message"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagedOnly: true }),
      });
      if (res.status === 503) {
        const ok = await confirm({
          title: "AI not configured in-app",
          message: "Hand off to your agent CLI to draft a commit message from the staged diff?",
          confirmLabel: "Open agent",
        });
        if (ok) {
          await launchAgentJob({
            title: `commit msg · ${repoName}`,
            kind: "agent",
            cwd: repoPath,
            repoName,
            promptText: agentCommitMessagePrompt(repoName),
            promptCommand: await agentCommitMessageCommand(repoName),
            mode: "oneshot",
            alreadyConfirmed: true,
          });
        }
        return;
      }
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as { message: string };
      setMessage(json.message);
      toast.success("Drafted commit message");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI draft failed");
    } finally {
      setAiBusy(false);
    }
  }

  /**
   * Conflicted paths: unstaging or discarding them isn't a git operation while
   * the index holds conflict stages — it fails with a raw "is unmerged" error.
   * Their rows get one honest action instead (stage to mark resolved) and the
   * destructive buttons go away.
   */
  const conflictedPaths = useMemo(
    () =>
      new Set((status?.files ?? []).filter(isUnmergedFile).map((f) => f.path)),
    [status],
  );

  /** Right-click menu for staged/unstaged rows — same actions as the row buttons. */
  const fileMenuGroups = useMemo((): ContextMenuGroup[] => {
    const target = fileMenu.target;
    if (!target) return [];
    const busy = acting !== null;
    const conflicted = conflictedPaths.has(target.path);
    const fileItems = [
      {
        id: "open-cursor",
        label: "Open in Cursor",
        description: target.path.split("/").pop(),
        onSelect: () => void openRepoFileInCursor(repoName, toast, target.path),
      },
      {
        id: "copy-path",
        label: "Copy path",
        icon: <Copy size={12} />,
        onSelect: () => {
          void copyTextToClipboard(target.path);
          toast.success("Path copied");
        },
      },
    ];
    if (target.staged) {
      return [
        {
          id: "index",
          items: [
            {
              id: "unstage",
              label: "Unstage",
              description: "git restore --staged",
              icon: <RotateCcw size={12} />,
              disabled: busy,
              onSelect: () => void stageAction("unstage", target.path),
            },
            {
              id: "discard-staged",
              label: "Discard staged changes",
              icon: <Trash2 size={12} />,
              danger: true,
              disabled: busy || conflicted,
              disabledReason: conflicted ? "Unresolved conflict" : undefined,
              onSelect: () => void stageAction("discard", target.path, { scope: "staged" }),
            },
          ],
        },
        { id: "file", items: fileItems },
      ];
    }
    return [
      {
        id: "worktree",
        items: [
          {
            id: "stage",
            label: "Stage",
            description: "git add",
            icon: <Check size={12} />,
            disabled: busy,
            onSelect: () => void stageAction("stage", target.path),
          },
          {
            id: "discard-unstaged",
            label: "Discard changes",
            icon: <Trash2 size={12} />,
            danger: true,
            disabled: busy || conflicted,
            disabledReason: conflicted ? "Unresolved conflict" : undefined,
            onSelect: () => void stageAction("discard", target.path, { scope: "unstaged" }),
          },
        ],
      },
      { id: "file", items: fileItems },
    ];
  }, [fileMenu.target, acting, conflictedPaths, repoName, stageAction, toast]);

  /**
   * Drag a file row between Staged and Unstaged. The sections carry
   * data-drop-stage; dropping calls the same stage/unstage endpoint the +/−
   * buttons use, so confirm flows and toasts stay in one place.
   */
  const fileDrag = usePointerDrag<{ path: string; from: "staged" | "unstaged" }>({
    dropSelector: "[data-drop-stage]",
    onDrop: (payload, target) => {
      const to = target.getAttribute("data-drop-stage");
      if (!to || to === payload.from) return;
      void stageAction(to === "staged" ? "stage" : "unstage", payload.path);
    },
  });

  if (loading && !status) {
    return <SkeletonRows count={4} height={28} />;
  }

  const stagedRaw = status?.staged ?? [];
  const unstagedOnlyRaw = (status?.files ?? []).filter((f) => f.unstaged && !f.staged);
  const bothRaw = (status?.files ?? []).filter((f) => f.staged && f.unstaged);
  const stagedSplit = splitNoiseFiles([...stagedRaw.filter((f) => !f.unstaged), ...bothRaw]);
  const unstagedSplit = splitNoiseFiles([...unstagedOnlyRaw, ...bothRaw]);
  const noisePaths = [
    ...new Set([...stagedSplit.noise, ...unstagedSplit.noise].map((f) => f.path)),
  ];
  const noiseCount = noisePaths.length;
  // Deduplicate paths that appear in both staged+unstaged (MM).
  const visibleDirtyCount = new Set(
    [...stagedSplit.visible, ...unstagedSplit.visible].map((f) => f.path),
  ).size;
  const noiseOnly = visibleDirtyCount === 0 && noiseCount > 0;
  // Noise paths are excluded: lockfiles and build junk couple to everything and
  // would make the companion hints meaningless.
  const dirtyPaths = [
    ...new Set([...stagedSplit.visible, ...unstagedSplit.visible].map((f) => f.path)),
  ];
  const cleanTree =
    Boolean(status?.clean) ||
    ((status?.files.length ?? 0) === 0 && !loading) ||
    (visibleDirtyCount === 0 && noiseCount === 0 && !loading);
  const contentSyncCount = status?.contentSyncCount ?? 0;
  const contentSyncHint =
    contentSyncCount > 0 ? (
      <div className="repo-git-noise-hint">
        <CloudUpload size={11} aria-hidden />
        <span>
          {contentSyncCount} content file{contentSyncCount === 1 ? "" : "s"} (notes / tasks /
          docs) not shown — synced from the cloud button in the top bar
        </span>
      </div>
    ) : null;

  return (
    <div className="repo-git-changes">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void refresh()}>
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} /> Refresh
        </button>
        <div className="repo-git-spacer" />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null}
          onClick={() => void undoLastCommit()}
        >
          <RotateCcw size={11} /> Undo commit
        </button>
      </div>

      {cleanTree || noiseOnly ? (
        <div className="repo-git-empty">
          <Check size={18} className="text-success" />
          <div>Working tree clean</div>
          <div style={{ color: "var(--text-subtle)", fontSize: 11 }}>
            {noiseOnly
              ? "No real changes — only system junk left behind."
              : "Nothing to stage. History and branches are one tab over."}
          </div>
          {contentSyncHint && <div style={{ marginTop: 10 }}>{contentSyncHint}</div>}
          {noiseOnly && (
            <div className="repo-git-noise-hint" style={{ marginTop: 10 }}>
              <span>
                {noiseCount} junk file{noiseCount === 1 ? "" : "s"} (.DS_Store / cache)
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginLeft: 8 }}
                disabled={acting !== null}
                onClick={() => void cleanJunkFiles(noisePaths)}
              >
                <Trash2 size={11} /> Clean junk files
              </button>
            </div>
          )}
        </div>
      ) : (
      <RepoSplit
        className="repo-git-changes-split"
        primaryFr={listFr}
        onPrimaryFrChange={setListFr}
        minPrimaryFr={0.22}
        maxPrimaryFr={0.62}
        handleLabel="Resize file list and diff"
        primary={
        <div className="repo-git-file-cols">
          <FileSection
            title="Staged"
            files={stagedSplit.visible}
            selected={selected}
            selectStaged
            dropStage="staged"
            onRowContextMenu={(event, file) => fileMenu.openAt(event, { path: file.path, staged: true })}
            dropOver={fileDrag.state?.over?.getAttribute("data-drop-stage") === "staged"}
            onRowDragStart={
              fileDrag.dragging
                ? undefined
                : (event, file) => {
                    if (event.pointerType !== "mouse") return;
                    fileDrag.start(event, { path: file.path, from: "staged" });
                  }
            }
            onSelect={(path) => setSelected({ path, staged: true })}
            headerAction={
              <>
                <IconBtn
                  label="Unstage all"
                  disabled={acting !== null || stagedSplit.visible.length === 0}
                  onClick={() =>
                    void stageAction("unstage", undefined, {
                      paths: stagedSplit.visible.map((f) => f.path),
                      successLabel: "Unstaged",
                    })
                  }
                >
                  Unstage all
                </IconBtn>
                <IconBtn
                  label="Discard all staged"
                  danger
                  disabled={acting !== null || stagedSplit.visible.length === 0}
                  onClick={() => void discardAllVisible("staged", stagedSplit.visible)}
                >
                  <Trash2 size={10} />
                </IconBtn>
              </>
            }
            actions={(path) =>
              conflictedPaths.has(path) ? (
                <IconBtn
                  label="Stage to mark resolved"
                  title="This file is in conflict — staging marks it resolved. The Conflicts tab has the merge editor."
                  onClick={() => void stageAction("stage", path)}
                  disabled={acting !== null}
                >
                  Resolve
                </IconBtn>
              ) : (
                <>
                  <IconBtn label="Unstage" onClick={() => void stageAction("unstage", path)} disabled={acting !== null}>
                    −
                  </IconBtn>
                  <IconBtn
                    label="Discard staged"
                    danger
                    onClick={() =>
                      void stageAction("discard", path, {
                        scope: "staged",
                        successLabel: "Discarded staged",
                      })
                    }
                    disabled={acting !== null}
                  >
                    <Trash2 size={10} />
                  </IconBtn>
                </>
              )
            }
          />
          <FileSection
            title="Unstaged"
            files={unstagedSplit.visible}
            selected={selected}
            selectStaged={false}
            dropStage="unstaged"
            onRowContextMenu={(event, file) => fileMenu.openAt(event, { path: file.path, staged: false })}
            dropOver={fileDrag.state?.over?.getAttribute("data-drop-stage") === "unstaged"}
            onRowDragStart={
              fileDrag.dragging
                ? undefined
                : (event, file) => {
                    if (event.pointerType !== "mouse") return;
                    fileDrag.start(event, { path: file.path, from: "unstaged" });
                  }
            }
            onSelect={(path) => setSelected({ path, staged: false })}
            headerAction={
              <>
                <IconBtn
                  label="Stage all"
                  disabled={acting !== null || unstagedSplit.visible.length === 0}
                  onClick={() =>
                    void stageAction("stage", undefined, {
                      paths: unstagedSplit.visible.map((f) => f.path),
                      successLabel: "Staged",
                    })
                  }
                >
                  Stage all
                </IconBtn>
                <IconBtn
                  label="Discard all unstaged"
                  danger
                  disabled={acting !== null || unstagedSplit.visible.length === 0}
                  onClick={() => void discardAllVisible("unstaged", unstagedSplit.visible)}
                >
                  <Trash2 size={10} />
                </IconBtn>
              </>
            }
            actions={(path) =>
              conflictedPaths.has(path) ? (
                <IconBtn
                  label="Stage to mark resolved"
                  title="This file is in conflict — staging marks it resolved. The Conflicts tab has the merge editor."
                  onClick={() => void stageAction("stage", path)}
                  disabled={acting !== null}
                >
                  Resolve
                </IconBtn>
              ) : (
                <>
                  <IconBtn label="Stage" onClick={() => void stageAction("stage", path)} disabled={acting !== null}>
                    +
                  </IconBtn>
                  <IconBtn
                    label="Discard"
                    danger
                    onClick={() =>
                      void stageAction("discard", path, {
                        scope: "unstaged",
                        successLabel: "Discarded",
                      })
                    }
                    disabled={acting !== null}
                  >
                    <Trash2 size={10} />
                  </IconBtn>
                </>
              )
            }
          />
          {noiseCount > 0 && (
            <div className="repo-git-noise-hint">
              <span>
                Hiding {noiseCount} system file{noiseCount === 1 ? "" : "s"} (.DS_Store / cache)
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginLeft: 6 }}
                disabled={acting !== null}
                onClick={() => void cleanJunkFiles(noisePaths)}
              >
                Clean junk
              </button>
            </div>
          )}
          {contentSyncHint}
          <CouplingHints repoName={repoName} changedPaths={dirtyPaths} />
        </div>
        }
        secondary={
        <div className="repo-git-diff-pane">
          <div className="repo-git-diff-head">
            {selected ? (
              <span className="font-mono truncate" title={selected.path}>
                {selected.staged ? "staged · " : "unstaged · "}
                {selected.path}
              </span>
            ) : (
              <span className="text-text-subtle">Select a file to inspect the diff</span>
            )}
            <DiffToolbar
              mode={contextMode}
              onModeChange={setContextMode}
              view={diffView}
              onViewChange={setDiffView}
              onMaximize={() => setDiffMaximized(true)}
              maximizeDisabled={!selected || Boolean(dirPreview)}
              openSlot={
                selected && !dirPreview ? (
                  <>
                    <ReviewBasket
                      repoName={repoName}
                      repoPath={repoPath}
                      onJumpTo={(path, staged) => setSelected({ path, staged })}
                    />
                    {isMd ? (
                      <div className="repo-git-diff-context">
                        <button
                          type="button"
                          className="repo-git-diff-context-btn"
                          data-active={mdPreview || undefined}
                          aria-pressed={mdPreview}
                          title="Rendered markdown preview of the new side"
                          disabled={diffLoading}
                          onClick={() => setMdPreview((v) => !v)}
                        >
                          <Eye size={11} aria-hidden /> Preview
                        </button>
                      </div>
                    ) : null}
                    <RepoFileOpenMenu repoName={repoName} filePath={selected.path} disabled={diffLoading} />
                  </>
                ) : null
              }
            />
          </div>
          <div
            key={selected ? `${selected.staged ? "s" : "u"}:${selected.path}` : "none"}
            className="repo-git-diff-body"
          >
            {diffLoading ? (
              <SkeletonRows count={8} height={14} />
            ) : dirPreview ? (
              <DirectoryPreview
                path={selected?.path ?? ""}
                entries={dirPreview.entries}
                message={dirPreview.message}
              />
            ) : isMd && mdPreview ? (
              <div className="repo-git-md-preview">
                {contextMode !== "full" ? (
                  <div className="repo-git-md-preview-hint">
                    Preview covers the loaded context — switch context to Full for the whole file.
                  </div>
                ) : null}
                <SimpleMarkdown text={mdText} />
              </div>
            ) : (
              <GitDiffView
                lines={diffLines}
                filePath={selected?.path}
                commentsEnabled
                view={diffView}
                hunkMode={selected ? (selected.staged ? "unstage" : "stage") : undefined}
                hunkBusy={acting !== null}
                onHunkAction={selected && rawDiff ? (a) => void hunkAction(a) : undefined}
                onSendSelectionToAi={selected ? (snippet, hint) => void sendSelectionToAi(snippet, hint) : undefined}
              />
            )}
          </div>
        </div>
        }
      />
      )}

      <ContextMenu
        open={Boolean(fileMenu.target)}
        position={fileMenu.position}
        groups={fileMenuGroups}
        onClose={fileMenu.close}
        label={fileMenu.target ? `Actions for ${fileMenu.target.path}` : "File actions"}
      />

      <DiffMaximizeModal
        maximized={diffMaximized}
        canOpen={Boolean(selected) && !dirPreview}
        onClose={closeMaximized}
        title={selected?.path ?? "Diff"}
        description={selected ? (selected.staged ? "Staged changes" : "Unstaged changes") : undefined}
        mode={contextMode}
        onModeChange={setContextMode}
        view={diffView}
        onViewChange={setDiffView}
        openSlot={
          selected ? (
            <>
              <ReviewBasket
                repoName={repoName}
                repoPath={repoPath}
                onJumpTo={(path, staged) => setSelected({ path, staged })}
              />
              {isMd ? (
                <div className="repo-git-diff-context">
                  <button
                    type="button"
                    className="repo-git-diff-context-btn"
                    data-active={mdPreview || undefined}
                    aria-pressed={mdPreview}
                    title="Rendered markdown preview of the new side"
                    disabled={diffLoading}
                    onClick={() => setMdPreview((v) => !v)}
                  >
                    <Eye size={11} aria-hidden /> Preview
                  </button>
                </div>
              ) : null}
              <RepoFileOpenMenu repoName={repoName} filePath={selected.path} disabled={diffLoading} />
            </>
          ) : null
        }
      >
        {diffLoading ? (
          <SkeletonRows count={12} height={14} />
        ) : isMd && mdPreview ? (
          <div className="repo-git-md-preview">
            {contextMode !== "full" ? (
              <div className="repo-git-md-preview-hint">
                Preview covers the loaded context — switch context to Full for the whole file.
              </div>
            ) : null}
            <SimpleMarkdown text={mdText} />
          </div>
        ) : (
          <GitDiffView
            lines={diffLines}
            filePath={selected?.path}
            commentsEnabled
            view={diffView}
            hunkMode={selected ? (selected.staged ? "unstage" : "stage") : undefined}
            hunkBusy={acting !== null}
            onHunkAction={selected && rawDiff ? (a) => void hunkAction(a) : undefined}
            onSendSelectionToAi={selected ? (snippet, hint) => void sendSelectionToAi(snippet, hint) : undefined}
          />
        )}
      </DiffMaximizeModal>

      {/* Commit bar stays mounted after a successful commit so the modal never
          feels "done"/closed — user can Push from the header next. */}
      {(visibleDirtyCount > 0 || message.trim() || acting === "commit") && (
        <div className="repo-git-commit-bar">
          <textarea
            className="input repo-git-commit-input"
            placeholder="Commit message…"
            value={message}
            rows={2}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="repo-git-commit-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={aiBusy || acting !== null}
              onClick={() => void suggestMessage()}
            >
              {aiBusy ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
              AI message
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!message.trim() || acting !== null}
              onClick={() => void commitAction({ action: "commit", message: message.trim(), amend: true })}
            >
              Amend
            </button>
            <div ref={commitMenuRef} className="repo-git-commit-split relative inline-flex">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!message.trim() || acting !== null || pushing}
                onClick={() => {
                  setCommitMenuOpen(false);
                  void commitWithMode(commitMode);
                }}
              >
                {acting === "commit" || (pushing && commitMode === "commit-and-push") ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : commitMode === "commit-and-push" ? (
                  <Upload size={11} />
                ) : (
                  <GitCommit size={11} />
                )}
                {commitMode === "commit-and-push" ? "Commit and push" : "Commit only"}
              </button>
              <button
                type="button"
                className="btn btn-primary repo-git-commit-caret"
                aria-label="Commit options"
                aria-haspopup="menu"
                aria-expanded={commitMenuOpen}
                disabled={!message.trim() || acting !== null || pushing}
                onClick={() => setCommitMenuOpen((open) => !open)}
              >
                <ChevronDown size={11} aria-hidden />
              </button>
              {commitMenuOpen && (
                <div role="menu" className="repo-git-commit-menu">
                  {(
                    [
                      ["commit-and-push", "Commit and push"],
                      ["commit-only", "Commit only"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={commitMode === mode}
                      className="repo-git-commit-menu-item"
                      data-active={commitMode === mode || undefined}
                      onClick={() => void commitWithMode(mode)}
                    >
                      <Check
                        size={11}
                        aria-hidden
                        style={{ visibility: commitMode === mode ? "visible" : "hidden" }}
                      />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DirectoryPreview({
  path,
  entries,
  message,
}: {
  path: string;
  entries: DiffDirEntry[];
  message?: string;
}) {
  return (
    <div className="repo-git-dir-preview">
      <div className="repo-git-dir-preview-lead">
        <Folder size={16} aria-hidden />
        <div>
          <div className="repo-git-dir-preview-title font-mono">{path || "directory"}</div>
          <p className="repo-git-dir-preview-msg">
            {message ?? "Untracked directory — stage the whole folder from the file list."}
          </p>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="repo-git-empty-sm">No visible contents.</div>
      ) : (
        <ul className="repo-git-dir-list">
          {entries.map((e) => (
            <li key={`${e.type}:${e.name}`} className="repo-git-dir-item">
              {e.type === "dir" ? <Folder size={12} aria-hidden /> : <File size={12} aria-hidden />}
              <span className="font-mono truncate">
                {e.name}
                {e.type === "dir" ? "/" : ""}
              </span>
              <span className="repo-git-dir-kind">{e.type === "dir" ? "folder" : "file"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileSection({
  title,
  files,
  selected,
  selectStaged,
  onSelect,
  actions,
  headerAction,
  dropStage,
  dropOver = false,
  onRowDragStart,
  onRowContextMenu,
}: {
  title: string;
  files: StatusFile[];
  selected: { path: string; staged: boolean } | null;
  selectStaged: boolean;
  onSelect: (path: string) => void;
  actions: (path: string) => ReactNode;
  headerAction?: ReactNode;
  /** Set when this section accepts dragged file rows. */
  dropStage?: "staged" | "unstaged";
  dropOver?: boolean;
  onRowDragStart?: (event: React.PointerEvent, file: StatusFile) => void;
  onRowContextMenu?: (event: React.MouseEvent, file: StatusFile) => void;
}) {
  return (
    <div
      className="repo-git-file-section"
      data-drop-stage={dropStage}
      data-drop-over={dropOver || undefined}
    >
      <div className="repo-git-section-label">
        <span>{title}</span>
        <span className="repo-git-section-label-end">
          {headerAction}
          <span className="badge badge-muted">{files.length}</span>
        </span>
      </div>
      {files.length === 0 ? (
        <div className="repo-git-empty-sm">Nothing here</div>
      ) : (
        files.map((f) => {
          const active = selected?.path === f.path && selected.staged === selectStaged;
          return (
            <div
              key={`${title}:${f.path}`}
              className="repo-git-file-row"
              data-active={active || undefined}
              data-conflict={isUnmergedFile(f) || undefined}
              onPointerDown={onRowDragStart ? (event) => onRowDragStart(event, f) : undefined}
              onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(event, f) : undefined}
              style={{ touchAction: onRowDragStart ? "none" : undefined }}
            >
              <button type="button" className="repo-git-file-main" onClick={() => onSelect(f.path)}>
                <span className="repo-git-file-status">{f.status}</span>
                {looksLikeDirectoryPath(f.path) ? <Folder size={11} aria-hidden /> : null}
                <span className="truncate font-mono" title={f.path}>{f.path}</span>
              </button>
              <div className="repo-git-file-actions">{actions(f.path)}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
