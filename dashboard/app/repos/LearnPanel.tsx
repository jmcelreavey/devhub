"use client";

import { useRouter } from "next/navigation";
import { GraduationCap, Maximize2, Minimize2, SquareArrowOutUpRight, X } from "lucide-react";
import { SidePanel } from "@/components/SidePanel";
import { LearnContent } from "./LearnContent";
import { openRepoInCursor } from "@/lib/open-in-cursor-client";
import { useToast } from "@/lib/use-toast";
import type { RepoInfo } from "./types";

export { parseFetchErrorMessage } from "./LearnContent";

/**
 * Side-panel wrapper around the shared LearnContent. "Expand" jumps to the
 * dedicated /repos/learn/[name] screen; "Hide" minimizes to the persistent
 * dock (which restores via that same screen).
 */
export function LearnPanel({
  repo,
  onClose,
}: {
  repo: RepoInfo | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  function hidePanel() {
    if (repo) {
      window.dispatchEvent(new CustomEvent("devhub:repo-learn-hidden", { detail: { repoName: repo.name } }));
    }
    onClose();
  }

  function expand() {
    if (!repo) return;
    onClose();
    router.push(`/repos/learn/${encodeURIComponent(repo.name)}`);
  }

  return (
    <SidePanel open={!!repo} onClose={onClose} storageKey="repos-learn-panel-width" defaultWidth={560} minWidth={420} ariaLabel="Repo learning panel">
      <div className="p-4 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>
            <GraduationCap size={13} aria-hidden /> Learn repo
          </div>
          <div className="mt-1 text-lg font-semibold truncate" style={{ color: "var(--text)" }}>{repo?.name}</div>
          <div className="text-xs truncate font-mono" style={{ color: "var(--text-subtle)" }}>
            Local path: {repo?.path}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => repo && void openRepoInCursor(repo.name, toast)}
            aria-label={`Open ${repo?.name} in Cursor`}
            title="Open the repo in Cursor"
            style={{ fontSize: 12, padding: "4px 9px" }}
          >
            <SquareArrowOutUpRight size={14} />
            Cursor
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={expand}
            aria-label="Open dedicated learning screen"
            title="Open as a full screen"
            style={{ fontSize: 12, padding: "4px 9px" }}
          >
            <Maximize2 size={14} />
            Expand
          </button>
          <button type="button" className="btn btn-ghost" onClick={hidePanel} aria-label="Hide learning panel" style={{ fontSize: 12, padding: "4px 9px" }}>
            <Minimize2 size={14} />
            Hide
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close learning panel" style={{ fontSize: 12, padding: "4px 9px" }}>
            <X size={14} />
            Close
          </button>
        </div>
      </div>

      <div className="p-4 overflow-auto">
        {repo && <LearnContent repo={repo} />}
      </div>
    </SidePanel>
  );
}
