"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  CornerUpLeft,
  RotateCw,
  ScrollText,
  Sparkles,
  Wrench,
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  formatBlockDuration,
  formatBlocksForClipboard,
  groupCommandBlocks,
  previewBlockCommand,
  type TerminalBlockGroup,
  type TerminalCommandBlock,
} from "@/lib/terminal-blocks";

/** Output lines shown before a card needs an expander. */
const PREVIEW_LINES = 6;

/**
 * Row actions, passed down as one object.
 *
 * These used to be five separate props re-declared identically on four
 * components; the shape is the contract, so name it once and spread it.
 */
export interface TerminalBlockHandlers {
  onCopy: (block: TerminalCommandBlock) => void;
  onSend: (block: TerminalCommandBlock) => void;
  onRerun: (block: TerminalCommandBlock) => void;
  onExplain?: (block: TerminalCommandBlock) => void;
  /** Open the raw grid scrolled to where this command ran. */
  onJump: (block: TerminalCommandBlock) => void;
}

/** Clipboard writes go through the helper — `navigator.clipboard` is undefined over LAN HTTP. */
function copy(text: string): void {
  void copyTextToClipboard(text).catch(() => {
    /* the helper already tried the textarea fallback; nothing left to do */
  });
}

function isFailed(block: TerminalCommandBlock): boolean {
  return typeof block.exitCode === "number" && block.exitCode !== 0;
}

function BlockOutput({ output, pending }: { output: string; pending?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const text = output.replace(/\s+$/, "");
  if (!text) return null;
  const lines = text.split("\n");
  const collapsible = lines.length > PREVIEW_LINES;
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
              <ChevronDown size={11} aria-hidden /> {lines.length - PREVIEW_LINES} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Compact action rail.
 *
 * Every action gets its own glyph. Two identical clipboard icons sitting side
 * by side (command vs output) read as one control rendered twice, and on touch
 * there is no hover title to disambiguate them.
 */
function BlockActions({
  block,
  handlers,
}: {
  block: TerminalCommandBlock;
  handlers: TerminalBlockHandlers;
}) {
  const { onCopy, onSend, onRerun, onExplain, onJump } = handlers;
  return (
    <div className="terminal-block-card-actions">
      <button
        type="button"
        title="Copy command"
        onClick={() => copy(block.command)}
        aria-label="Copy command"
      >
        <ClipboardCopy size={12} aria-hidden />
      </button>
      <button type="button" title="Copy output" onClick={() => onCopy(block)} aria-label="Copy output">
        <ScrollText size={12} aria-hidden />
      </button>
      <button type="button" title="Rerun" onClick={() => onRerun(block)} aria-label="Rerun command">
        <RotateCw size={12} aria-hidden />
      </button>
      <button type="button" title="Send to Agent" onClick={() => onSend(block)} aria-label="Send to Agent">
        <Sparkles size={12} aria-hidden />
      </button>
      {isFailed(block) && onExplain && (
        <button
          type="button"
          title="Explain failure"
          onClick={() => onExplain(block)}
          aria-label="Explain failure"
        >
          <Wrench size={12} aria-hidden />
        </button>
      )}
      <button
        type="button"
        title="Show in terminal"
        onClick={() => onJump(block)}
        aria-label="Open in terminal at this command"
      >
        <CornerUpLeft size={12} aria-hidden />
      </button>
    </div>
  );
}

function BlockCard({
  block,
  waitingInputId,
  handlers,
}: {
  block: TerminalCommandBlock;
  waitingInputId?: string;
  handlers: TerminalBlockHandlers;
}) {
  const failed = isFailed(block);
  const duration = formatBlockDuration(block.startedAt, block.endedAt);

  return (
    <li
      className="terminal-block-card"
      data-failed={failed || undefined}
      data-pending={block.pending || undefined}
    >
      <div className="terminal-block-card-head">
        <span className="terminal-block-glyph" aria-hidden>
          ❯
        </span>
        <button
          type="button"
          className="terminal-block-card-cmd"
          title={`${block.command}\nClick to copy`}
          onClick={() => copy(block.command)}
        >
          {previewBlockCommand(block.command, 96)}
        </button>
        <span className="terminal-block-card-meta">
          {block.pending ? (
            <>
              {waitingInputId === block.id && (
                <span className="terminal-block-badge" data-state="input">
                  input
                </span>
              )}
              <span className="terminal-block-badge" data-state="running">
                run
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
                  {failed ? block.exitCode : "ok"}
                </span>
              )}
              {duration && <span className="terminal-block-duration">{duration}</span>}
            </>
          )}
        </span>
        {!block.pending && <BlockActions block={block} handlers={handlers} />}
      </div>
      <BlockOutput output={block.output} pending={block.pending} />
    </li>
  );
}

function BlockGroup({
  group,
  waitingInputId,
  handlers,
}: {
  group: TerminalBlockGroup;
  waitingInputId?: string;
  handlers: TerminalBlockHandlers;
}) {
  const multi = group.blocks.length > 1;
  const duration = formatBlockDuration(group.startedAt, group.endedAt);
  const failedInGroup = group.blocks.filter(isFailed).length;

  return (
    <section className="terminal-block-group" data-multi={multi || undefined}>
      {multi && (
        <header className="terminal-block-group-head">
          <span className="terminal-block-group-label">
            {group.blocks.length} commands
            {duration ? ` · ${duration}` : ""}
            {failedInGroup ? ` · ${failedInGroup} failed` : ""}
          </span>
          <button
            type="button"
            className="terminal-block-group-copy"
            title="Copy all commands and output in this group"
            onClick={() => copy(formatBlocksForClipboard(group.blocks))}
          >
            <ClipboardCopy size={11} aria-hidden /> Copy group
          </button>
        </header>
      )}
      {/*
        No aria-label here: the outer list is already named "Command blocks", and
        labelling every burst re-announced "Command group" once per group.
      */}
      <ol className="terminal-block-group-list">
        {group.blocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            waitingInputId={waitingInputId}
            handlers={handlers}
          />
        ))}
      </ol>
    </section>
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
} & TerminalBlockHandlers) {
  const listRef = useRef<HTMLElement>(null);
  const lastDoneIdRef = useRef<string | null>(null);
  const groups = useMemo(() => groupCommandBlocks(blocks), [blocks]);
  const handlers = useMemo<TerminalBlockHandlers>(
    () => ({ onCopy, onSend, onRerun, onExplain, onJump }),
    [onCopy, onSend, onRerun, onExplain, onJump],
  );

  const failedCount = blocks.filter(isFailed).length;
  const runningCount = blocks.filter((b) => b.pending).length;

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
        <p>
          Run a command below — each one becomes a card with output, exit code, and quick actions.
        </p>
        <p className="terminal-blocks-hint">
          Full-screen apps (vim, htop) drop back to the live terminal automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="terminal-blocks-pane-inner">
      <div className="terminal-blocks-toolbar">
        <span className="terminal-blocks-summary">
          {blocks.length} {blocks.length === 1 ? "cmd" : "cmds"}
          {runningCount ? ` · ${runningCount} running` : ""}
          {failedCount ? ` · ${failedCount} failed` : ""}
        </span>
        <button
          type="button"
          className="terminal-blocks-toolbar-action"
          title="Copy all commands and output"
          onClick={() => copy(formatBlocksForClipboard(blocks))}
        >
          <ClipboardCopy size={11} aria-hidden /> Copy all
        </button>
      </div>
      {/*
        A <section> with a name, not a div with an aria-label — aria-label on a
        generic element is ignored. Not role="list": the children are grouped
        <section>s, and a list must contain listitems.
      */}
      <section className="terminal-blocks-view" ref={listRef} aria-label="Command blocks">
        {groups.map((group, index) => (
          <BlockGroup
            key={`${group.startedAt}-${index}`}
            group={group}
            waitingInputId={waitingInputId}
            handlers={handlers}
          />
        ))}
      </section>
    </div>
  );
}
