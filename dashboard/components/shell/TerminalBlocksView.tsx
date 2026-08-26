"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  CornerUpLeft,
  RotateCw,
  Sparkles,
} from "lucide-react";
import {
  formatBlockDuration,
  previewBlockCommand,
  type TerminalCommandBlock,
} from "@/lib/terminal-blocks";

/** Output lines shown before a card needs an expander. */
const PREVIEW_LINES = 8;

function BlockOutput({ output, pending }: { output: string; pending?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const text = output.replace(/\s+$/, "");
  if (!text) return null;
  const lines = text.split("\n");
  const collapsible = lines.length > PREVIEW_LINES;
  // Finished blocks lead with their head; a still-running block's story is at
  // the tail — that's where an interactive prompt appears.
  const shown =
    expanded || !collapsible
      ? text
      : (pending ? lines.slice(-PREVIEW_LINES) : lines.slice(0, PREVIEW_LINES)).join("\n");
  return (
    <div className="terminal-block-output-wrap">
      <pre className="terminal-block-output" data-pending={pending || undefined}>
        {shown}
      </pre>
      {collapsible && (
        <button
          type="button"
          className="terminal-block-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp size={11} aria-hidden /> Collapse
            </>
          ) : (
            <>
              <ChevronDown size={11} aria-hidden /> {lines.length - PREVIEW_LINES} more lines
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Warp-style DOM rendering of finished command blocks. The xterm grid stays
 * mounted underneath (sessions must persist); this pane replaces it visually
 * until a full-screen app or a long-running command needs raw mode.
 */
export function TerminalBlocksView({
  blocks,
  waitingInputId,
  onCopy,
  onSend,
  onRerun,
  onExplain,
  onJump,
}: {
  blocks: TerminalCommandBlock[];
  /** Pending block whose last output looks like an interactive prompt. */
  waitingInputId?: string;
  onCopy: (block: TerminalCommandBlock) => void;
  onSend: (block: TerminalCommandBlock) => void;
  onRerun: (block: TerminalCommandBlock) => void;
  onExplain?: (block: TerminalCommandBlock) => void;
  /** Open the raw grid scrolled to where this command ran. */
  onJump: (block: TerminalCommandBlock) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastDoneIdRef = useRef<string | null>(null);

  // Keep the newest completed block in view without yanking scroll while
  // the user reads older cards. A pending block pins to the bottom only when
  // the user is already there, so live output streams like a terminal.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = blocks[blocks.length - 1];
    if (last?.pending) {
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      if (nearBottom) list.scrollTop = list.scrollHeight;
      return;
    }
    const done = [...blocks].reverse().find((b) => !b.pending);
    if (!done || done.id === lastDoneIdRef.current) return;
    lastDoneIdRef.current = done.id;
    list.scrollTop = list.scrollHeight;
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <div className="terminal-blocks-view" data-empty="">
        <p>Each command becomes a card: output, exit code, duration. Copy, rerun, or send it to Agent.</p>
        <p className="terminal-blocks-hint">
          Full-screen apps (vim, htop) and long-running commands drop back to the live terminal
          automatically.
        </p>
      </div>
    );
  }
  const failedCount = blocks.filter((b) => typeof b.exitCode === "number" && b.exitCode !== 0).length;
  const runningCount = blocks.filter((b) => b.pending).length;

  return (
    <div className="terminal-blocks-pane-inner">
    <div className="terminal-blocks-summary">
      {blocks.length} {blocks.length === 1 ? "command" : "commands"}
      {runningCount ? ` · ${runningCount} running` : ""}
      {failedCount ? ` · ${failedCount} failed` : ""}
    </div>
    <ol className="terminal-blocks-view" ref={listRef} aria-label="Command blocks">
      {blocks.map((block) => {
        const failed = typeof block.exitCode === "number" && block.exitCode !== 0;
        const duration = formatBlockDuration(block.startedAt, block.endedAt);
        return (
          <li key={block.id} className="terminal-block-card" data-failed={failed || undefined}>
            <div className="terminal-block-card-head">
              <span className="terminal-block-glyph" aria-hidden>
                ❯
              </span>
              <code className="terminal-block-card-cmd" title={block.command}>
                {previewBlockCommand(block.command, 120)}
              </code>
              <span className="terminal-block-card-meta">
                {block.pending ? (
                  <>
                    {waitingInputId === block.id && (
                      <span className="terminal-block-badge" data-state="input">
                        waiting for input
                      </span>
                    )}
                    <span className="terminal-block-badge" data-state="running">
                      running
                    </span>
                  </>
                ) : (
                  <>
                    {typeof block.exitCode === "number" && (
                      <span
                        className="terminal-block-badge"
                        data-state={failed ? "fail" : "ok"}
                        title={`Exit code ${block.exitCode}`}
                      >
                        {failed ? `exit ${block.exitCode}` : "ok"}
                      </span>
                    )}
                    {duration && <span className="terminal-block-duration">{duration}</span>}
                  </>
                )}
              </span>
            </div>
            <BlockOutput output={block.output} pending={block.pending} />
            {!block.pending && (
              <div className="terminal-block-card-actions">
                <button type="button" onClick={() => void navigator.clipboard.writeText(block.command)} aria-label="Copy command">
                  <ClipboardCopy size={11} aria-hidden /> Command
                </button>
                <button type="button" onClick={() => onCopy(block)} aria-label="Copy command output">
                  <ClipboardCopy size={11} aria-hidden /> Output
                </button>
                <button type="button" onClick={() => onRerun(block)} aria-label="Rerun command">
                  <RotateCw size={11} aria-hidden /> Rerun
                </button>
                <button type="button" onClick={() => onSend(block)} aria-label="Send to Agent">
                  <Sparkles size={11} aria-hidden /> Agent
                </button>
                {failed && onExplain && (
                  <button
                    type="button"
                    onClick={() => onExplain(block)}
                    aria-label="Explain failure"
                  >
                    <Sparkles size={11} aria-hidden /> Explain
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onJump(block)}
                  aria-label="Open in terminal at this command"
                >
                  <CornerUpLeft size={11} aria-hidden /> In terminal
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
    </div>
  );
}
