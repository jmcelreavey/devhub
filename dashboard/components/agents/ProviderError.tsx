"use client";

import { useRef } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { proposeTerminalRun } from "@/lib/terminal-inject";

export function ProviderError({ provider = "Agent", error, onRepair }: { provider?: string; error: string; onRepair?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cursorLogin = /cursor/i.test(provider + error) && /auth|sign.?in|login/i.test(error);
  const mcpConfig = /mcp\.devhub/i.test(error);
  const piPrefix = /pi|pi-rustdex/i.test(provider + error) && /ENOENT|prefix|node_modules/i.test(error);
  const hint = cursorLogin
    ? "Sign in to the Cursor agent CLI in DevHub's terminal (inside WSL on Windows), then try again."
    : mcpConfig
      ? "Repair DevHub's OpenCode MCP entry, then retry the agent. The original config is saved beside it as opencode.json.devhub-backup."
      : piPrefix
        ? "Reinstall managed Paseo from Agents → Connection to use DevHub's writable tools directory, then retry Pi."
        : "Check the details below and Agents → Connection before retrying.";
  return <div className="space-y-2 text-sm">
    <p role="alert">{!cursorLogin && !mcpConfig && !piPrefix && error.length < 160 && !error.includes("\n") ? error : `${provider} couldn't start.`}</p>
    <p className="text-xs text-text-muted">{hint}</p>
    <div className="flex flex-wrap gap-2">
      {cursorLogin && <button type="button" className="btn btn-ghost" onClick={() => proposeTerminalRun({ command: "agent login", label: "Sign in to Cursor", summary: "Sign in to the Cursor agent CLI", reason: "Cursor needs a CLI sign-in before it can start an agent.", kind: "shell", source: "ui" })}>Sign in to Cursor</button>}
      {cursorLogin && <code className="text-xs self-center">agent login</code>}
      {mcpConfig && onRepair && <button type="button" className="btn btn-ghost" onClick={onRepair}>Repair DevHub MCP</button>}
      <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.showModal()}>Details</button>
    </div>
    <dialog ref={dialog} aria-label={`${provider} startup details`} className="m-auto max-h-[85dvh] overflow-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl border border-border bg-bg-elevated text-text p-5 backdrop:bg-black/50">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold">{provider} startup details</h3>
        <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <p className="text-sm text-text-muted mb-3">{hint}</p>
      <pre className="text-xs whitespace-pre-wrap break-words max-h-[50dvh] overflow-auto bg-bg p-3 rounded">{error}</pre>
      <div className="mt-3"><CopyButton text={error} label="Copy details" /></div>
    </dialog>
  </div>;
}
