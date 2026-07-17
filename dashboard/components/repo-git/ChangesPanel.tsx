"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  CloudUpload,
  File,
  Folder,
  GitCommit,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { useConfirm, usePrompt } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import {
  agentCommitMessageCommand,
  agentDiffSelectionCommand,
  openTerminal,
} from "@/lib/terminal-launch";
import { isGitNoisePath, looksLikeDirectoryPath, type DiffLine } from "@/lib/repo-git-parsers";
import { GitDiffView } from "./GitDiffView";
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

function splitNoiseFiles(files: StatusFile[]): { visible: StatusFile[]; noise: StatusFile[] } {
  const visible: StatusFile[] = [];
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
}: GitPanelHandlers & {
  repoName: string;
  repoPath: string;
  onVisibleDirtyChange?: (count: number) => void;
  pushing: boolean;
  onPush: () => Promise<void>;
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
  const [message, setMessage] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // Safe to read localStorage in the initializer: the panel only mounts
  // client-side, after the workspace modal opens.
  const [commitMode, setCommitMode] = useState<CommitMode>(() => readCommitModePref());
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const commitMenuRef = useRef<HTMLDivElement>(null);

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
  }, [selected, repoName, toast]);

  async function stageAction(
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
  }

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
      toast.success(selected.staged ? "Unstaged hunk" : "Staged hunk");
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
    openTerminal({
      cwd: repoPath,
      label: `diff · ${repoName}`,
      command: await agentDiffSelectionCommand({
        repoName,
        filePath: selected.path,
        snippet,
        lineHint,
        context: context.trim() || undefined,
        staged: selected.staged,
      }),
    });
    toast.info("Agent opened in the terminal.");
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
      const result = await postGitAction(repoApi(repoName, "/branches"), { action, ...extra });
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
          openTerminal({
            cwd: repoPath,
            label: `commit msg · ${repoName}`,
            command: await agentCommitMessageCommand(repoName),
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
          onClick={() => void commitAction({ action: "undo-commit" })}
        >
          <RotateCcw size={11} /> Undo commit
        </button>
      </div>

      {cleanTree || noiseOnly ? (
        <div className="repo-git-empty">
          <Check size={18} style={{ color: "var(--success)" }} />
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
      <div className="repo-git-changes-grid">
        <div className="repo-git-file-cols">
          <FileSection
            title="Staged"
            files={stagedSplit.visible}
            selected={selected}
            selectStaged
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
            actions={(path) => (
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
            )}
          />
          <FileSection
            title="Unstaged"
            files={unstagedSplit.visible}
            selected={selected}
            selectStaged={false}
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
            actions={(path) => (
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
            )}
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
        </div>

        <div className="repo-git-diff-pane">
          <div className="repo-git-diff-head">
            {selected ? (
              <span className="font-mono truncate" title={selected.path}>
                {selected.staged ? "staged · " : "unstaged · "}
                {selected.path}
              </span>
            ) : (
              <span style={{ color: "var(--text-subtle)" }}>Select a file to inspect the diff</span>
            )}
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
            ) : (
              <GitDiffView
                lines={diffLines}
                hunkMode={selected ? (selected.staged ? "unstage" : "stage") : undefined}
                hunkBusy={acting !== null}
                onHunkAction={selected && rawDiff ? (a) => void hunkAction(a) : undefined}
                onSendSelectionToAi={selected ? (snippet, hint) => void sendSelectionToAi(snippet, hint) : undefined}
              />
            )}
          </div>
        </div>
      </div>
      )}

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
}: {
  title: string;
  files: StatusFile[];
  selected: { path: string; staged: boolean } | null;
  selectStaged: boolean;
  onSelect: (path: string) => void;
  actions: (path: string) => ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <div className="repo-git-file-section">
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
