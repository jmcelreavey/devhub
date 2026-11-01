"use client";

import { ClipboardCopy, RotateCw, Sparkles, X } from "lucide-react";
import {
  formatBlockDuration,
  previewBlockCommand,
  type TerminalCommandBlock,
} from "@/lib/terminal/blocks";

export function TerminalBlockHistory({
  blocks,
  onCopy,
  onSend,
  onRerun,
  onExplain,
  onDismiss,
}: {
  blocks: TerminalCommandBlock[];
  onCopy: (block: TerminalCommandBlock) => void;
  onSend: (block: TerminalCommandBlock) => void;
  onRerun: (block: TerminalCommandBlock) => void;
  /** AI explain/fix — only shown for nonzero exits. */
  onExplain?: (block: TerminalCommandBlock) => void;
  /** Hide the rail. Restored from the toolbar. */
  onDismiss?: () => void;
}) {
  if (blocks.length === 0) return null;
  const shown = [...blocks.slice(-24)].reverse();

  return (
    <div className="terminal-block-rail">
      <div className="terminal-block-rail-head">
        <span>Agent commands</span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Hide agent commands">
            <X size={11} aria-hidden />
          </button>
        )}
      </div>
      <ol className="terminal-block-rail-list" aria-label="Agent commands">
      {shown.map((block) => {
        const failed = typeof block.exitCode === "number" && block.exitCode !== 0;
        const duration = formatBlockDuration(block.startedAt, block.endedAt);
        return (
          <li
            key={block.id}
            className="terminal-block-chip"
            data-pending={block.pending || undefined}
            data-failed={failed || undefined}
          >
            <code className="terminal-block-cmd" title={block.command}>
              {previewBlockCommand(block.command)}
            </code>
            {!block.pending && (
              <span className="terminal-block-chip-meta">
                {typeof block.exitCode === "number" && (
                  <span className="terminal-block-badge" data-state={failed ? "fail" : "ok"}>
                    {failed ? block.exitCode : "ok"}
                  </span>
                )}
                {duration && <span className="terminal-block-duration">{duration}</span>}
              </span>
            )}
            <div className="terminal-block-actions">
              <button
                type="button"
                onClick={() => onCopy(block)}
                aria-label="Copy command output"
                disabled={block.pending && !block.output}
              >
                <ClipboardCopy size={11} aria-hidden /> Copy
              </button>
              <button type="button" onClick={() => onSend(block)} aria-label="Send to Agent">
                <Sparkles size={11} aria-hidden /> Agent
              </button>
              <button type="button" onClick={() => onRerun(block)} aria-label="Rerun command">
                <RotateCw size={11} aria-hidden /> Rerun
              </button>
              {failed && onExplain && (
                <button type="button" onClick={() => onExplain(block)} aria-label="Explain failure">
                  <Sparkles size={11} aria-hidden /> Explain
                </button>
              )}
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
