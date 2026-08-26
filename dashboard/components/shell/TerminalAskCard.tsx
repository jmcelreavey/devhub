"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

export interface TerminalAskState {
  question: string;
  startedAt: number;
  phase: "thinking" | "answered" | "failed";
  answer?: string;
  endedAt?: number;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1_000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

/**
 * Echo of an in-flight prompt-bar Ask. The submitted question stays visible
 * with a live "Agent thinking…" status (shimmer = content arriving); a text
 * answer or failure renders in place. When the reply contains a runnable
 * command the proposal chip takes over and this card is dropped. The prompt
 * bar's Stop button cancels the request.
 */
export function TerminalAskCard({
  state,
  onDismiss,
}: {
  state?: TerminalAskState;
  onDismiss: () => void;
}) {
  const thinking = state?.phase === "thinking";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!thinking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [thinking]);
  if (!state) return null;
  const elapsed = formatElapsed((thinking ? now : (state.endedAt ?? now)) - state.startedAt);

  return (
    <div
      className="terminal-ask-card"
      data-phase={state.phase}
      role="status"
      aria-live="polite"
    >
      <div className="terminal-ask-question">
        <Sparkles size={12} aria-hidden />
        <span>{state.question}</span>
      </div>
      {thinking ? (
        <div className="terminal-ask-progress">
          <span className="terminal-ask-shimmer" aria-hidden />
          <span className="terminal-ask-status">Agent thinking… {elapsed}</span>
        </div>
      ) : (
        <div className="terminal-ask-answer">
          <p>{state.answer}</p>
          <button
            type="button"
            className="terminal-ask-dismiss"
            aria-label="Dismiss answer"
            onClick={onDismiss}
          >
            <X size={11} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
