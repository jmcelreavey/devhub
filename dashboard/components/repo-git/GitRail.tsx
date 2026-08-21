"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Tag } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import type { StashConflictPayload } from "@/app/repos/types";
import { postGitAction, repoApi, type RepoGitTabId } from "./shared";

export interface RailSummary {
  currentBranch: string;
  ahead: number;
  behind: number;
  stashes: number;
  branches: { name: string; current: boolean; upstream?: string | null }[];
  remoteBranches: {
    name: string;
    remote: string;
    localName: string;
    trackedLocalName: string | null;
  }[];
  tags: string[];
}

/**
 * Persistent left column inside the Git workspace.
 *
 * Tabs hide state behind mode switches; the rail keeps branches, remotes,
 * tags and stashes visible no matter which tab is open — the thing that makes
 * a git GUI feel like a place rather than a stack of dialogs. Branch rows are
 * drop targets for the History tab's commit drag (data-drop-branch).
 */
export function GitRail({
  repoName,
  summary,
  onMutate,
  onConflict,
  onOpenTab,
}: {
  repoName: string;
  summary: RailSummary | null;
  onMutate: () => void;
  onConflict: (c: StashConflictPayload) => Promise<void>;
  onOpenTab: (tab: RepoGitTabId) => void;
}) {
  const toast = useToast();
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [remotesOpen, setRemotesOpen] = useState(false);

  const localBranches = useMemo(() => summary?.branches ?? [], [summary]);
  const remoteOnly = useMemo(
    () =>
      (summary?.remoteBranches ?? []).filter((r) => !r.trackedLocalName),
    [summary],
  );

  async function checkout(branch: string) {
    if (busyBranch) return;
    setBusyBranch(branch);
    try {
      const result = await postGitAction(repoApi(repoName, "/branches"), {
        action: "checkout",
        branch,
      });
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.kind);
      }
      onMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyBranch(null);
    }
  }

  async function checkoutRemote(remoteRef: string) {
    const suggested = remoteRef.replace(/^[^/]+\//, "");
    if (busyBranch) return;
    setBusyBranch(remoteRef);
    try {
      const result = await postGitAction<{ branch?: string }>(repoApi(repoName, "/branches"), {
        action: "checkout-remote",
        branch: remoteRef,
        newBranch: suggested,
      });
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.kind);
      }
      toast.success(`Checked out ${suggested}`);
      onMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyBranch(null);
    }
  }

  return (
    <aside className="repo-git-rail" aria-label="Repository overview">
      <div className="repo-git-rail-section">
        <div className="repo-git-section-label">Branches</div>
        {(summary ? localBranches : []).map((b) => (
          <button
            key={b.name}
            type="button"
            className="repo-git-rail-branch"
            data-current={b.current || undefined}
            disabled={Boolean(busyBranch) && busyBranch !== b.name}
            title={b.current ? `${b.name} — checked out` : `Check out ${b.name}`}
            onClick={() => void checkout(b.name)}
            data-drop-branch={b.current ? undefined : b.name}
          >
            <span className="truncate font-mono">{b.name}</span>
            {b.current && summary && (summary.ahead > 0 || summary.behind > 0) && (
              <span className="repo-git-rail-counts" aria-label="Ahead and behind upstream">
                {summary.ahead > 0 && <span data-dir="ahead">↑{summary.ahead}</span>}
                {summary.behind > 0 && <span data-dir="behind">↓{summary.behind}</span>}
              </span>
            )}
          </button>
        ))}
        {!summary && <div className="repo-git-empty-sm">Loading…</div>}
      </div>

      {remoteOnly.length > 0 && (
        <div className="repo-git-rail-section">
          <button
            type="button"
            className="repo-git-section-label repo-git-rail-toggle"
            aria-expanded={remotesOpen}
            onClick={() => setRemotesOpen((v) => !v)}
          >
            {remotesOpen ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
            Remotes
            <span className="badge badge-muted">{remoteOnly.length}</span>
          </button>
          {remotesOpen &&
            remoteOnly.map((r) => (
              <button
                key={r.name}
                type="button"
                className="repo-git-rail-branch"
                disabled={busyBranch !== null}
                title={`Create local ${r.localName} tracking this branch`}
                onClick={() => void checkoutRemote(r.name)}
              >
                <span className="truncate font-mono">{r.name}</span>
              </button>
            ))}
        </div>
      )}

      <div className="repo-git-rail-section">
        <div className="repo-git-section-label">
          Stashes
          <span className="badge badge-muted">{summary?.stashes ?? 0}</span>
        </div>
        {(summary?.stashes ?? 0) > 0 && (
          <button
            type="button"
            className="repo-git-rail-branch"
            onClick={() => onOpenTab("stash")}
          >
            <Layers size={11} aria-hidden />
            Open stash list
          </button>
        )}
      </div>

      {(summary?.tags.length ?? 0) > 0 && (
        <div className="repo-git-rail-section repo-git-rail-tags">
          <div className="repo-git-section-label">
            <Tag size={10} aria-hidden /> Tags
          </div>
          {summary!.tags.slice(0, 12).map((t) => (
            <span key={t} className="repo-git-rail-tag font-mono truncate" title={t}>
              {t}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}
