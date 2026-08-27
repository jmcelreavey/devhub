/**
 * Guardrail before launching another spendy agent implementation.
 *
 * This deliberately reads `/api/terminal/sessions`, not the proposal store.
 * `proposeTerminalRun` is a `window.dispatchEvent` — a UI launch never creates
 * a server-side proposal, so counting pending proposals meant this never fired
 * for the flow it exists to protect. The dock heartbeats every visible tab into
 * the session registry, so live agent tabs are the honest signal.
 */

import { isAgentLikeKind, type TerminalSessionKind } from "@/lib/terminal-meta";

/** Concurrent busy agent tabs tolerated before we make the user resolve one. */
export const MAX_CONCURRENT_AGENT_RUNS = 2;

interface SessionRow {
  label?: string;
  kind?: TerminalSessionKind;
  status?: string;
  busy?: boolean;
}

export interface ImplementGuardrailResult {
  blocked: boolean;
  reason?: string;
  runningCount: number;
}

/** Agent-kind tabs that are open and mid-command. */
export function countBusyAgentRuns(sessions: SessionRow[]): number {
  return sessions.filter((s) => isAgentLikeKind(s.kind) && s.status === "open" && s.busy === true)
    .length;
}

export function describeAgentRunGuardrail(runningCount: number): ImplementGuardrailResult {
  if (runningCount < MAX_CONCURRENT_AGENT_RUNS) return { blocked: false, runningCount };
  return {
    blocked: true,
    runningCount,
    reason: `${runningCount} agent runs are already working in the terminal — let one finish before starting another.`,
  };
}

/** Fails open: a guardrail that can't read the registry must not block work. */
export async function checkImplementGuardrails(): Promise<ImplementGuardrailResult> {
  try {
    const res = await fetch("/api/terminal/sessions", { cache: "no-store" });
    if (!res.ok) return { blocked: false, runningCount: 0 };
    const data = (await res.json()) as { sessions?: SessionRow[] };
    return describeAgentRunGuardrail(countBusyAgentRuns(data.sessions ?? []));
  } catch {
    return { blocked: false, runningCount: 0 };
  }
}
