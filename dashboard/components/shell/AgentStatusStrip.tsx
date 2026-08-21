"use client";

import { Trash2 } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";
import {
  formatAgentStatusLine,
  type AgentUiPhase,
} from "@/lib/agent-status";
import type { DockFrame } from "@/lib/terminal-dock-state";

/**
 * Frame is a property of the dock, not of the Agent pane — the window controls
 * that used to live here now render once in the dock bar (DockFrameControls)
 * so shell tabs get them too. Kept as an alias so callers keep compiling.
 */
export type AgentChatFrame = DockFrame;

/** Product status strip above agent/review PTYs — not shell chrome. */
export function AgentStatusStrip({
  phase,
  summary,
  providerLabel,
  onClear,
}: {
  phase: AgentUiPhase;
  summary?: string;
  providerLabel?: string;
  onClear?: () => void;
}) {
  const line = formatAgentStatusLine({ phase, summary, providerLabel });
  return (
    <div className="terminal-agent-strip" data-phase={phase} role="status" aria-live="polite" aria-atomic="true">
      <span className="terminal-agent-strip-pulse" aria-hidden />
      <span className="terminal-agent-strip-text">{line}</span>
      <div className="terminal-agent-strip-actions">
        {onClear ? (
          <HoverTip label="Clear" pos="top-end">
            <button
              type="button"
              className="hub-icon-btn terminal-dock-btn"
              aria-label="Clear conversation"
              onClick={onClear}
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </HoverTip>
        ) : null}
      </div>
    </div>
  );
}

export function AgentUnavailableState({
  message,
  onSetup,
}: {
  message: string;
  onSetup: () => void;
}) {
  return (
    <div className="terminal-agent-empty" role="alert">
      <p className="terminal-agent-empty-copy">{message}</p>
      <button type="button" className="btn btn-primary text-xs" onClick={onSetup}>
        Setup
      </button>
    </div>
  );
}
