"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { TerminalSession } from "@/components/TerminalDock";

type Status = "connecting" | "open" | "closed";

/**
 * Full-page terminal (/terminal). One zsh login-shell session rooted at the
 * developer directory. The everywhere-popout lives in TerminalDock (⌃`);
 * this page is for when you want the whole viewport.
 */
export function TerminalView() {
  const [status, setStatus] = useState<Status>("connecting");
  // Bump to tear down and rebuild the session.
  const [generation, setGeneration] = useState(0);

  const statusLabel =
    status === "open"
      ? "zsh · ~/Developer"
      : status === "connecting"
        ? "Connecting…"
        : "Disconnected — is the PTY peer running?";

  return (
    <div className="terminal-shell">
      <div className="terminal-bar">
        <span className="terminal-dot" data-status={status} aria-hidden />
        <span className="terminal-bar-label">{statusLabel}</span>
        <span className="terminal-bar-actions">
          <button
            type="button"
            className="hub-icon-btn"
            onClick={() => setGeneration((g) => g + 1)}
            data-tooltip="Restart session"
            data-tooltip-pos="bottom-end"
            aria-label="Restart terminal session"
          >
            <RotateCw size={12} aria-hidden />
          </button>
        </span>
      </div>
      <TerminalSession key={generation} active onStatus={setStatus} />
    </div>
  );
}
