"use client";

import { useCallback, useState } from "react";
import { Check, Gauge, Sparkles, Undo2, Wand2, X } from "lucide-react";
import { postDbAction, dbApi } from "./shared";

interface AiSqlBarProps {
  connectionId: string;
  /** Current editor contents — the subject of Fix / Explain / Optimise. */
  statement: string;
  /** The engine's last error, when there is one. Enables Fix. */
  lastError: string | null;
  /** Table in view, sent so the model gets its real columns. */
  focus?: { namespace: string; name: string } | null;
  /** Replace the editor contents. */
  onApply: (sql: string) => void;
  /** Seeded from a context menu ("Ask AI about this row…"). */
  seedPrompt?: string;
  onSeedConsumed?: () => void;
}

interface AiResponse {
  sql: string;
  note?: string;
  provider: string;
}

/**
 * Ask for a query, or ask for the one you have to be fixed.
 *
 * The result **replaces the editor contents rather than running**, which is the
 * whole design: a generated statement is classified and gated exactly like one
 * you typed, so the model cannot reach the database except through the same
 * door you do. It also means you get to read it first, which for anything
 * pointed at production is the entire point.
 *
 * The previous statement is kept so Undo is one click — a generated query that
 * is worse than what you had should cost nothing to reject.
 */
export function AiSqlBar({
  connectionId,
  statement,
  lastError,
  focus,
  onApply,
  seedPrompt,
  onSeedConsumed,
}: AiSqlBarProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<null | "generate" | "fix" | "explain" | "optimise">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const visiblePrompt = seedPrompt ?? prompt;

  const consumeSeed = useCallback(
    (nextPrompt: string = seedPrompt ?? prompt) => {
      if (!seedPrompt) return;
      setPrompt(nextPrompt);
      onSeedConsumed?.();
    },
    [seedPrompt, prompt, onSeedConsumed],
  );

  const ask = useCallback(
    async (mode: "generate" | "fix" | "explain" | "optimise") => {
      consumeSeed();
      setBusy(mode);
      setError(null);
      setNote(null);

      const response = await postDbAction<AiResponse>(dbApi(connectionId, "/ai"), {
        mode,
        prompt: visiblePrompt,
        statement: statement || undefined,
        error: mode === "fix" ? lastError ?? undefined : undefined,
        focus: focus ?? undefined,
      });

      setBusy(null);

      if (!response.ok) {
        setError(response.message);
        return;
      }

      if (response.json.note && !response.json.sql) {
        setNote(response.json.note);
        return;
      }

      setPrevious(statement);
      onApply(response.json.sql);
      if (mode === "generate") setPrompt("");
    },
    [connectionId, visiblePrompt, statement, lastError, focus, onApply, consumeSeed],
  );

  const undo = useCallback(() => {
    if (previous === null) return;
    onApply(previous);
    setPrevious(null);
  }, [previous, onApply]);

  if (!open && !seedPrompt) {
    return (
      <div className="db-ai-triggers">
        <button type="button" className="btn btn-ghost db-ai-trigger" onClick={() => setOpen(true)}>
          <Sparkles size={13} aria-hidden /> Ask AI
        </button>
        {lastError && (
          <button
            type="button"
            className="btn btn-ghost db-ai-trigger"
            onClick={() => {
              setOpen(true);
              void ask("fix");
            }}
          >
            <Wand2 size={13} aria-hidden /> Fix this query
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="db-ai card">
      <div className="db-ai-row">
        <Sparkles size={14} className="db-ai-icon" aria-hidden />
        <input
          className="input db-ai-input"
          value={visiblePrompt}
          onChange={(e) => {
            if (seedPrompt) consumeSeed(e.target.value);
            else setPrompt(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && visiblePrompt.trim() && !busy) void ask("generate");
            if (e.key === "Escape") {
              consumeSeed();
              setOpen(false);
            }
          }}
          placeholder="Describe the query you want — e.g. published posts by author, last 30 days"
          aria-label="Describe the query you want"
          autoFocus
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void ask("generate")}
          disabled={!visiblePrompt.trim() || busy !== null}
        >
          {busy === "generate" ? "Writing…" : "Generate"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            consumeSeed();
            setOpen(false);
          }}
          aria-label="Close AI panel"
        >
          <X size={14} />
        </button>
      </div>

      <div className="db-ai-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void ask("fix")}
          disabled={!statement.trim() || busy !== null}
          title={lastError ?? "Fix the current query"}
        >
          <Wand2 size={13} aria-hidden /> {busy === "fix" ? "Fixing…" : "Fix"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void ask("explain")}
          disabled={!statement.trim() || busy !== null}
        >
          <Check size={13} aria-hidden /> {busy === "explain" ? "Reading…" : "Explain"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void ask("optimise")}
          disabled={!statement.trim() || busy !== null}
        >
          <Gauge size={13} aria-hidden /> {busy === "optimise" ? "Thinking…" : "Optimise"}
        </button>
        {previous !== null && (
          <button type="button" className="btn btn-ghost" onClick={undo}>
            <Undo2 size={13} aria-hidden /> Undo
          </button>
        )}
        <span className="db-ai-hint">
          Generated SQL lands in the editor. Nothing runs until you press Run.
        </span>
      </div>

      {note && <p className="tone-panel tone-panel--muted db-ai-note">{note}</p>}
      {error && <p className="tone-panel tone-panel--warning db-ai-note">{error}</p>}
    </div>
  );
}
