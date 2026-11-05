"use client";

import { useRouter } from "@/lib/navigation";
import { GraduationCap, ExternalLink, PanelBottomClose } from "lucide-react";
import { SidePanel, SidePanelControls } from "@/components/shell/SidePanel";
import { HoverTip } from "@/components/ui/HoverTip";
import { LearnContent } from "./LearnContent";
import type { RepoInfo } from "@shared/repos/types";

/**
 * Side-panel wrapper around LearnContent (panel skim). Hide docks generation;
 * Close dismisses. Expand opens the dedicated /repos/learn/[name] screen.
 */
export function LearnPanel({
  repo,
  onHide,
  onClose,
}: {
  repo: RepoInfo | null;
  onHide: () => void;
  onClose: () => void;
}) {
  const router = useRouter();

  function expand() {
    if (!repo) return;
    onClose();
    router.push(`/repos/learn/${encodeURIComponent(repo.name)}`);
  }

  return (
    <SidePanel open={!!repo} onClose={onClose} storageKey="repos-learn-panel-width" defaultWidth={560} minWidth={420} ariaLabel="Repo learning panel">
      <div className="repos-learn-chrome" data-panel-drag-handle>
        <div className="min-w-0 flex-1">
          <div className="repos-learn-kicker">
            <GraduationCap size={13} aria-hidden />
            Learn
          </div>
          <div className="repos-learn-title truncate" title={repo?.name}>
            {repo?.name}
          </div>
          {repo?.path && (
            <div className="repos-learn-path truncate font-mono" title={repo.path}>
              {repo.path}
            </div>
          )}
        </div>
        <div className="repos-learn-actions">
          <HoverTip label="Open full learning screen">
            <button
              type="button"
              className="btn btn-ghost hub-icon-btn"
              onClick={expand}
              aria-label="Open dedicated learning screen"
            >
              <ExternalLink size={14} />
            </button>
          </HoverTip>
          <HoverTip label="Hide and keep generating in the dock">
            <button
              type="button"
              className="btn btn-ghost hub-icon-btn"
              onClick={onHide}
              aria-label="Hide learning panel to dock"
            >
              <PanelBottomClose size={14} />
            </button>
          </HoverTip>
          <SidePanelControls closeLabel="Close learning panel" />
        </div>
      </div>

      <div className="p-4 overflow-auto">
        {repo && <LearnContent repo={repo} variant="panel" />}
      </div>
    </SidePanel>
  );
}
