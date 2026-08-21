"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import {
  isDestructiveTerminalCommand,
  type TerminalProposeDetail,
} from "@/lib/terminal-inject";
import { formatProposePreview, previewTerminalCommand } from "@/lib/terminal-dock-state";

/**
 * Confirm / edit / deny chip for proposed terminal runs.
 * Destructive commands escalate to a modal-style panel.
 * Remount with `key={proposal.id}` when the proposal changes.
 */
export function TerminalProposeBar({
  proposal,
  busy,
  queued,
  injectError,
  onConfirm,
  onDeny,
}: {
  proposal: TerminalProposeDetail;
  busy: boolean;
  /** Confirmed; waiting for the shell to go quiet before inject. */
  queued?: boolean;
  injectError?: string | null;
  onConfirm: (command: string) => void;
  onDeny: () => void;
}) {
  const destructive = isDestructiveTerminalCommand(proposal.command);
  const [editing, setEditing] = useState(destructive);
  const [draft, setDraft] = useState(proposal.command);
  const friendly = formatProposePreview(proposal);
  const commandTooltip = previewTerminalCommand(proposal.command, 500);
  const isAgentJob = proposal.source === "agent-job" || proposal.kind === "agent" || proposal.kind === "review";
  const reasonBits = [proposal.source === "mcp" ? "MCP" : null, proposal.reason]
    .filter(Boolean)
    .join(" · ");
  const reasonDuplicatesFriendly =
    !!proposal.reason?.trim() && proposal.reason.trim() === friendly.trim();
  const showReason = Boolean(reasonBits) && !(isAgentJob && reasonDuplicatesFriendly);
  const title = queued
    ? "Waiting for the shell"
    : destructive
      ? "Destructive command"
      : isAgentJob
        ? friendly
        : "Run this?";

  return (
    <div
      className="terminal-propose-bar"
      data-destructive={destructive || undefined}
      data-queued={queued || undefined}
      data-agent={isAgentJob || undefined}
      role="region"
      aria-label={isAgentJob ? "Confirm agent job" : "Confirm terminal command"}
    >
      <div className="terminal-propose-meta">
        <span className="terminal-propose-title">{title}</span>
        {showReason && <span className="terminal-propose-reason">{reasonBits}</span>}
      </div>
      {editing && !queued ? (
        <textarea
          className="terminal-propose-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(6, Math.max(2, draft.split("\n").length))}
          aria-label="Edit command before running"
        />
      ) : isAgentJob ? null : (
        <code className="terminal-propose-cmd" title={commandTooltip}>
          {friendly}
        </code>
      )}
      {injectError && (
        <p className="terminal-propose-busy" role="alert">
          {injectError}
        </p>
      )}
      {!injectError && (queued || busy) && (
        <p className="terminal-propose-busy">
          {queued
            ? "Shell’s busy — injecting when it goes quiet."
            : "Shell’s busy. Confirm waits, or deny."}
        </p>
      )}
      <div className="terminal-propose-actions">
        <button type="button" className="btn btn-ghost text-xs" onClick={onDeny}>
          <X size={12} aria-hidden /> {queued ? "Cancel" : "Deny"}
        </button>
        {!queued && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => setEditing((v) => !v)}
            title={editing ? "Hide raw command" : "Show / edit raw command"}
          >
            <Pencil size={12} aria-hidden /> {editing ? "Preview" : "Advanced"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary text-xs"
          data-variant={destructive ? "danger" : undefined}
          onClick={() => onConfirm(draft.trim())}
          disabled={!draft.trim() || queued}
        >
          <Check size={12} aria-hidden />{" "}
          {queued ? "Waiting…" : destructive ? "Run anyway" : isAgentJob ? "Start" : "Run"}
        </button>
      </div>
    </div>
  );
}
