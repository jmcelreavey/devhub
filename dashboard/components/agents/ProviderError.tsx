"use client";

import { useRef, useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { InlineCodeText } from "@/components/ui/InlineCodeText";
import { describeProviderError } from "@/lib/agent/provider-error";
import { proposeTerminalRun } from "@/lib/terminal-inject";

type RepairState = { phase: "idle" | "working" } | { phase: "done"; restartRequired: boolean } | { phase: "failed"; message: string };

async function repairOpenCodeMcp(): Promise<boolean> {
  const response = await fetch("/api/paseo/managed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "repair-opencode-mcp" }) });
  const data = await response.json().catch(() => ({})) as { error?: string; restartRequired?: boolean };
  if (!response.ok) throw new Error(data.error || "Could not repair DevHub's MCP entry.");
  return data.restartRequired === true;
}

/**
 * An agent that would not start: one line saying why, the single next step as a
 * real button, and the raw log behind Details (collapsed, ANSI stripped).
 */
export function ProviderError({ provider = "Agent", error, onRepaired }: { provider?: string; error: string; onRepaired?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [repair, setRepair] = useState<RepairState>({ phase: "idle" });
  const view = describeProviderError(provider, error);

  async function runRepair() {
    setRepair({ phase: "working" });
    try {
      setRepair({ phase: "done", restartRequired: await repairOpenCodeMcp() });
      onRepaired?.();
    } catch (err) {
      setRepair({ phase: "failed", message: err instanceof Error ? err.message : "Could not repair DevHub's MCP entry." });
    }
  }

  const actions = <>
    {view.kind === "cursor-login" && <button type="button" className="btn btn-primary" onClick={() => proposeTerminalRun({ command: "agent login", label: "Sign in to Cursor", summary: "Sign in to the Cursor agent CLI", reason: "Cursor needs a CLI sign-in before it can start an agent.", kind: "shell", source: "ui" })}>Sign in to Cursor</button>}
    {view.kind === "opencode-mcp" && <button type="button" className="btn btn-primary" disabled={repair.phase === "working"} onClick={() => void runRepair()}>{repair.phase === "working" ? "Repairing…" : "Repair DevHub MCP entry"}</button>}
  </>;
  const repairNote = repair.phase === "done"
    ? <p className="text-xs text-success" role="status">Repaired. {repair.restartRequired ? "Restart Paseo from Agents → Connection to apply it, then retry." : "Retry the agent."}</p>
    : repair.phase === "failed" ? <p className="text-xs text-danger" role="alert">{repair.message}</p> : null;

  return <div className="space-y-2 text-sm">
    <p role="alert">{view.summary}</p>
    <p className="text-xs text-text-muted"><InlineCodeText text={view.hint} copyCommands /></p>
    <div className="flex flex-wrap gap-2">
      {actions}
      <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.showModal()}>Details</button>
    </div>
    {repairNote}
    <dialog ref={dialog} aria-label={`${provider} startup details`} className="m-auto max-h-[85dvh] overflow-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl border border-border bg-bg-elevated text-text p-5 backdrop:bg-black/50">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold">{provider} startup details</h3>
        <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <p className="font-medium mb-1">{view.summary}</p>
      <p className="text-sm text-text-muted mb-3"><InlineCodeText text={view.hint} copyCommands /></p>
      <div className="flex flex-wrap gap-2 mb-3">{actions}</div>
      {repairNote}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-text-muted">Raw log</summary>
        <pre className="mt-2 text-xs whitespace-pre-wrap break-words max-h-[50dvh] overflow-auto bg-bg p-3 rounded">{view.log}</pre>
        <div className="mt-2"><CopyButton text={view.log} label="raw log" showLabel /></div>
      </details>
    </dialog>
  </div>;
}
