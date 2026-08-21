"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History, RotateCw, Send, Sparkles, Square } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";
import { previewPromptCommand } from "@/lib/terminal-prompt";
import { fuzzyFilterHistory } from "@/lib/terminal-history";

const MAX_EDITOR_LINES = 6;

export function TerminalPromptBar({
  cwd,
  repoName,
  lastCommand,
  history = [],
  asking,
  askError,
  focused,
  onRun,
  onAsk,
  onCancelAsk,
  onRerun,
  onSendLastToAgent,
}: {
  cwd?: string;
  repoName?: string;
  lastCommand?: string;
  /** Recent commands (newest first) for ↑/↓ and ⌃R. */
  history?: string[];
  asking?: boolean;
  askError?: string | null;
  /** When true (active tab, dock open), own the keyboard like Warp's editor. */
  focused?: boolean;
  onRun: (command: string) => void;
  onAsk: (text: string) => void;
  onCancelAsk?: () => void;
  onRerun?: (command: string) => void;
  onSendLastToAgent?: (command: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"run" | "ask">("run");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(0);
  /** Draft being edited before history navigation started. */
  const draftBackupRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => fuzzyFilterHistory(history, draft), [history, draft]);
  const where = repoName || cwd?.replace(/^\/Users\/[^/]+/, "~") || "";

  // Auto-grow the editor up to a cap.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const lines = Math.min(MAX_EDITOR_LINES, draft.split("\n").length);
    el.style.height = `${Math.min(el.scrollHeight, lines * 20 + 12)}px`;
  }, [draft]);

  // Take the keyboard when this becomes the active tab — in blocks mode the
  // grid is hidden, so the bottom editor is the only sensible key target.
  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);

  const submit = () => {
    const text = draft.trim();
    if (!text || asking) return;
    if (mode === "ask") onAsk(text);
    else onRun(text);
    setDraft("");
    setHistoryOpen(false);
    draftBackupRef.current = null;
  };

  const applyHistory = (nextIndex: number) => {
    if (draftBackupRef.current === null) draftBackupRef.current = draft;
    if (nextIndex < 0 || nextIndex >= history.length) return;
    setHistoryIndex(nextIndex);
    setDraft(history[nextIndex] ?? "");
    setHistoryOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (asking) return;

    // ⌃R — fuzzy history search over the current draft.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      setHistoryOpen((v) => !v);
      return;
    }
    if (historyOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHistoryIndex((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHistoryIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const pick = matches[historyIndex];
        if (pick) {
          setDraft(pick);
          setHistoryOpen(false);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setHistoryOpen(false);
        return;
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Enter" && e.metaKey && e.shiftKey) {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      onAsk(text);
      setDraft("");
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }

    // ↑/↓ walk history only when the caret can't move further in that
    // direction — otherwise they should move within a multi-line draft.
    if (e.key === "ArrowDown" && !e.shiftKey) {
      const el = e.currentTarget;
      const caret = el.selectionStart ?? 0;
      const lastBreak = draft.lastIndexOf("\n");
      if (caret > lastBreak) {
        e.preventDefault();
        if (draftBackupRef.current !== null && historyIndex > 0) {
          applyHistory(historyIndex - 1);
        } else if (draftBackupRef.current !== null) {
          setDraft(draftBackupRef.current);
          draftBackupRef.current = null;
          setHistoryIndex(0);
        }
        return;
      }
    }
  };

  // ↑ walks backwards through history starting at the newest entry.
  const handleArrowUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const caret = el.selectionStart ?? 0;
    const firstLineEnd = draft.indexOf("\n");
    const onFirstLine = firstLineEnd === -1 || caret <= firstLineEnd;
    if (!onFirstLine || history.length === 0) return;
    e.preventDefault();
    if (draftBackupRef.current === null) {
      draftBackupRef.current = draft;
      applyHistory(0);
    } else {
      applyHistory(Math.min(historyIndex + 1, history.length - 1));
    }
  };

  return (
    <div className="terminal-prompt">
      {lastCommand ? (
        <div className="terminal-prompt-block">
          <code title={lastCommand}>{previewPromptCommand(lastCommand)}</code>
          <div className="terminal-prompt-block-actions">
            {onRerun ? (
              <button type="button" onClick={() => onRerun(lastCommand)}>
                <RotateCw size={11} aria-hidden /> Rerun
              </button>
            ) : null}
            {onSendLastToAgent ? (
              <button type="button" onClick={() => onSendLastToAgent(lastCommand)}>
                <Sparkles size={11} aria-hidden /> Agent
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <form
        className="terminal-prompt-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {where ? <span className="terminal-prompt-chip">{where}</span> : null}
        <div className="terminal-prompt-editor-wrap">
          <textarea
            ref={inputRef}
            className="input terminal-prompt-input terminal-prompt-editor"
            value={draft}
            disabled={asking}
            rows={1}
            spellCheck={false}
            placeholder={mode === "ask" ? "Ask, then confirm a command" : "Command · Enter to run, ⇧Enter newline, ⌃R history"}
            aria-label={mode === "ask" ? "Ask input" : "Command input"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && !e.shiftKey) handleArrowUp(e);
              else onKeyDown(e);
            }}
          />
          {historyOpen && (
            <ul className="terminal-history-pop" role="listbox" aria-label="Command history">
              {matches.length === 0 ? (
                <li className="terminal-history-empty">No matching commands</li>
              ) : (
                matches.map((cmd, i) => (
                  <li key={`${cmd}-${i}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === historyIndex}
                      data-active={i === historyIndex || undefined}
                      onMouseEnter={() => setHistoryIndex(i)}
                      onClick={() => {
                        setDraft(cmd);
                        setHistoryOpen(false);
                        inputRef.current?.focus();
                      }}
                    >
                      <History size={11} aria-hidden />
                      <code>{previewPromptCommand(cmd, 90)}</code>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <HoverTip label={mode === "ask" ? "Ask → confirm" : "Run"} pos="top-end">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            aria-pressed={mode === "ask"}
            onClick={() => setMode((m) => (m === "ask" ? "run" : "ask"))}
          >
            {mode === "ask" ? "Ask" : "Run"}
          </button>
        </HoverTip>
        {asking ? (
          <button
            type="button"
            className="btn btn-ghost terminal-prompt-send"
            aria-label="Stop"
            onClick={() => onCancelAsk?.()}
          >
            <Square size={12} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary terminal-prompt-send"
            disabled={!draft.trim()}
            aria-label={mode === "ask" ? "Ask" : "Run"}
          >
            {mode === "ask" ? (
              <Sparkles size={13} aria-hidden />
            ) : (
              <Send size={13} aria-hidden />
            )}
          </button>
        )}
      </form>
      {askError ? (
        <p className="terminal-prompt-error" role="alert">
          {askError}
        </p>
      ) : null}
    </div>
  );
}
