"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Layers, Tag } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import type { StashConflictPayload } from "@/app/repos/types";
import { postGitAction, repoApi, type RepoGitTabId } from "./shared";

export interface RailSummary {  currentBranch: string;
  ahead: number;
  behind: number;
  stashes: number;
  branches: {
    name: string;
    current: boolean;
    upstream?: string | null;
    ahead?: number;
    behind?: number;
    upstreamGone?: boolean;
  }[];
  remoteBranches: {
    name: string;
    remote: string;
    localName: string;
    trackedLocalName: string | null;
  }[];
  tags: string[];
}

/** Toggleable section header. Module-level: a component defined inside the
 *  parent would remount (and lose focus) on every render. */
function SectionHeader({
  label,
  count,
  open,
  onToggle,
  icon,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="repo-git-section-label repo-git-rail-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
      {icon}
      {label}
      <span className="badge badge-muted">{count}</span>
    </button>
  );
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
  // Every section toggles — long tag/branch lists shouldn't push the rest of
  // the rail out of reach, and a collapsed section reads as skippable.
  const [branchesOpen, setBranchesOpen] = useState(true);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);

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
        <SectionHeader
          label="Branches"
          count={localBranches.length}
          open={branchesOpen}
          onToggle={() => setBranchesOpen((v) => !v)}
        />
        {branchesOpen && (summary ? localBranches : []).map((b) => {
          const ahead = b.current ? summary!.ahead : b.ahead ?? 0;
          const behind = b.current ? summary!.behind : b.behind ?? 0;
          const gone = b.upstreamGone;
          return (
            <button
              key={b.name}
              type="button"
              className="repo-git-rail-branch"
              data-current={b.current || undefined}
              disabled={Boolean(busyBranch) && busyBranch !== b.name}
              title={
                b.current
                  ? `${b.name} — checked out`
                  : gone
                    ? `${b.name} — upstream is gone`
                    : `Check out ${b.name}`
              }
              onClick={() => void checkout(b.name)}
              data-drop-branch={b.current ? undefined : b.name}
            >
              <span className="truncate font-mono">{b.name}</span>
              <span className="repo-git-rail-counts" aria-label="Ahead and behind upstream">
                {gone && <span data-dir="gone" title="Upstream deleted">⌫</span>}
                {ahead > 0 && <span data-dir="ahead">↑{ahead}</span>}
                {behind > 0 && <span data-dir="behind">↓{behind}</span>}
              </span>
            </button>
          );
        })}
        {!summary && <div className="repo-git-empty-sm">Loading…</div>}
      </div>

      {remoteOnly.length > 0 && (
        <div className="repo-git-rail-section">
          <SectionHeader
            label="Remotes"
            count={remoteOnly.length}
            open={remotesOpen}
            onToggle={() => setRemotesOpen((v) => !v)}
          />
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
        <SectionHeader
          label="Stashes"
          count={summary?.stashes ?? 0}
          open={stashOpen}
          onToggle={() => setStashOpen((v) => !v)}
          icon={<Layers size={10} aria-hidden />}
        />
        {stashOpen && (summary?.stashes ?? 0) > 0 && (
          <button
            type="button"
            className="repo-git-rail-branch"
            onClick={() => onOpenTab("stash")}
          >
            Open stash list
          </button>
        )}
      </div>

      {(summary?.tags.length ?? 0) > 0 && (
        <div className="repo-git-rail-section repo-git-rail-tags">
          <SectionHeader
            label="Tags"
            count={summary!.tags.length}
            open={tagsOpen}
            onToggle={() => setTagsOpen((v) => !v)}
            icon={<Tag size={10} aria-hidden />}
          />
          {tagsOpen &&
            summary!.tags.slice(0, 12).map((t) => (
              <span key={t} className="repo-git-rail-tag font-mono truncate" title={t}>
                {t}
              </span>
            ))}
        </div>
      )}
    </aside>
  );
}
