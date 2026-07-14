"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpFromLine, GitCommit, RotateCw, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import type { BranchesApiPayload } from "@/app/repos/types";

interface RepoGitActionsProps {
  repoName: string;
  dirtyCount: number;
  unpushedCount: number;
  onMutate: () => void;
}

export function RepoGitActions({ repoName, dirtyCount, unpushedCount, onMutate }: RepoGitActionsProps) {
  const [open, setOpen] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [details, setDetails] = useState<BranchesApiPayload | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [message, setMessage] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const hasDirty = dirtyCount > 0;
  const hasUnpushed = unpushedCount > 0;

  const fetchDetails = useCallback(async () => {
    setLoadingDetails(true);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/branches`);
      if (!res.ok) throw new Error(await res.text());
      setDetails((await res.json()) as BranchesApiPayload);
    } catch (err) {
      toast.error(`Couldn't load repo details: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setLoadingDetails(false);
    }
  }, [repoName, toast]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    if (!open) void fetchDetails();
    setOpen(!open);
  }

  async function act(action: string, msg?: string) {
    setActing(action);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message: msg }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Action failed"));
      const labels: Record<string, string> = {
        commit: "Committed",
        push: "Pushed",
        discard: "Changes discarded",
      };
      toast.success(labels[action] ?? "Done");
      if (action === "commit") setMessage("");
      onMutate();
      if (open) void fetchDetails();
      if (action !== "push" || !hasDirty) setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  async function handleDiscard() {
    const ok = await confirm({
      title: `Discard all changes in ${repoName}?`,
      message: "Resets tracked files and removes untracked files. Cannot be undone.",
      confirmLabel: "Discard",
      variant: "danger",
    });
    if (ok) await act("discard");
  }

  async function handleCommit() {
    const msg = message.trim();
    if (!msg) {
      toast.error("Commit message required");
      return;
    }
    await act("commit", msg);
  }

  return (
    <div ref={containerRef} className="relative inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggleOpen}
        className={hasDirty ? "badge badge-warning" : "badge badge-success"}
        style={{ cursor: "pointer" }}
        aria-expanded={open}
      >
        {hasDirty ? (
          <>
            <AlertCircle size={10} /> {dirtyCount} changed
          </>
        ) : (
          "clean"
        )}
      </button>
      {hasUnpushed && (
        <button
          type="button"
          onClick={toggleOpen}
          className="repo-unpushed-badge"
          style={{ cursor: "pointer" }}
          aria-expanded={open}
        >
          <ArrowUpFromLine size={10} aria-hidden /> {unpushedCount} unpushed
        </button>
      )}

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-md border p-2 shadow-xl"
          style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
        >
          {loadingDetails && !details && (
            <div className="p-2 text-xs" style={{ color: "var(--text-subtle)" }}>
              Loading git details...
            </div>
          )}
          {hasDirty && (
            <div className="mb-2">
              {details?.changedFiles.length ? (
                <div className="mb-2 rounded border p-2" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1 text-xs font-semibold" style={{ color: "var(--text)" }}>
                    Changed files
                  </div>
                  <div className="space-y-1">
                    {details.changedFiles.map((file) => (
                      <div key={`${file.status}:${file.path}`} className="flex gap-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                        <span style={{ color: "var(--warning)", minWidth: 18 }}>{file.status}</span>
                        <span className="truncate" title={file.path}>{file.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <input
                className="input mb-1.5"
                placeholder="Commit message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCommit();
                }}
                style={{ fontSize: 12, padding: "4px 8px" }}
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: "3px 8px", flex: 1 }}
                  disabled={acting !== null}
                  onClick={() => void handleCommit()}
                >
                  {acting === "commit" ? (
                    "Committing..."
                  ) : (
                    <>
                      <GitCommit size={11} /> Commit
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: "3px 8px", color: "var(--danger)" }}
                  disabled={acting !== null}
                  onClick={() => void handleDiscard()}
                >
                  {acting === "discard" ? (
                    "Discarding..."
                  ) : (
                    <>
                      <Trash2 size={11} /> Discard
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
          {hasUnpushed && (
            <div>
              {details?.unpushedCommits.length ? (
                <div className="mb-2 rounded border p-2" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1 text-xs font-semibold" style={{ color: "var(--text)" }}>
                    Unpushed commits
                  </div>
                  <div className="space-y-2">
                    {details.unpushedCommits.map((commit) => (
                      <details key={commit.hash} className="text-xs">
                        <summary className="cursor-pointer" style={{ color: "var(--text)" }}>
                          <span className="font-mono" style={{ color: "var(--accent)" }}>{commit.hash}</span> {commit.subject}
                        </summary>
                        {commit.files.length > 0 && (
                          <div className="mt-1 space-y-0.5 pl-4 font-mono" style={{ color: "var(--text-muted)" }}>
                            {commit.files.map((file) => (
                              <div key={file} className="truncate" title={file}>{file}</div>
                            ))}
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost w-full"
                style={{ fontSize: 11, padding: "4px 8px" }}
                disabled={acting !== null}
                onClick={() => void act("push")}
              >
                {acting === "push" ? (
                  <>
                    <RotateCw size={11} className="animate-spin" /> Pushing...
                  </>
                ) : (
                  <>
                    <Upload size={11} /> Push {unpushedCount} commit{unpushedCount === 1 ? "" : "s"}
                  </>
                )}
              </button>
            </div>
          )}
          {!hasDirty && !hasUnpushed && (
            <div className="p-2 text-xs" style={{ color: "var(--text-subtle)" }}>
              Clean working tree, nothing to push.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
