/**
 * In-memory terminal proposal queue (dashboard process).
 *
 * MCP `terminal_propose_run` posts here; TerminalDock polls/resolves via
 * `/api/terminal/propose`. Desktop tickets alone never imply user intent —
 * the dock UI must confirm before inject.
 */

import type { TerminalSessionKind } from "@/lib/terminal-meta";
import { isDestructiveTerminalCommand, newTerminalProposeId } from "@/lib/terminal-inject";

export type TerminalProposalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "injected"
  | "failed";

export interface TerminalProposal {
  id: string;
  command: string;
  cwd?: string;
  label?: string;
  summary?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  preferAgentTab: boolean;
  reason?: string;
  source: "mcp" | "api";
  destructive: boolean;
  status: TerminalProposalStatus;
  createdAt: number;
  resolvedAt?: number;
  /** Edited command when the user tweaked before approve. */
  finalCommand?: string;
  error?: string;
}

const TTL_MS = 15 * 60 * 1_000;
const MAX_PENDING = 20;

const proposals = new Map<string, TerminalProposal>();

function prune(): void {
  const now = Date.now();
  for (const [id, p] of proposals) {
    if (p.status === "pending" && now - p.createdAt > TTL_MS) {
      p.status = "expired";
      p.resolvedAt = now;
    }
    if (p.resolvedAt && now - p.resolvedAt > TTL_MS) {
      proposals.delete(id);
    }
  }
}

export function createTerminalProposal(input: {
  command: string;
  cwd?: string;
  label?: string;
  summary?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  preferAgentTab?: boolean;
  reason?: string;
  source?: "mcp" | "api";
}): TerminalProposal {
  prune();
  const pending = [...proposals.values()].filter((p) => p.status === "pending");
  if (pending.length >= MAX_PENDING) {
    throw new Error("Too many pending terminal proposals — resolve or deny some in the dock first.");
  }
  const command = input.command.trim();
  if (!command) throw new Error("command is required");
  if (command.length > 8_000) throw new Error("command too long");

  const proposal: TerminalProposal = {
    id: newTerminalProposeId(),
    command,
    cwd: input.cwd,
    label: input.label,
    summary: input.summary,
    kind: input.kind,
    repoName: input.repoName,
    preferAgentTab: input.preferAgentTab !== false,
    reason: input.reason,
    source: input.source ?? "api",
    destructive: isDestructiveTerminalCommand(command),
    status: "pending",
    createdAt: Date.now(),
  };
  proposals.set(proposal.id, proposal);
  return proposal;
}

export function listTerminalProposals(opts?: { status?: TerminalProposalStatus }): TerminalProposal[] {
  prune();
  // FIFO — oldest pending first so newer MCP proposals don't starve older chips.
  const all = [...proposals.values()].sort((a, b) => a.createdAt - b.createdAt);
  if (opts?.status) return all.filter((p) => p.status === opts.status);
  return all;
}

export function getTerminalProposal(id: string): TerminalProposal | null {
  prune();
  return proposals.get(id) ?? null;
}

export function resolveTerminalProposal(
  id: string,
  action: "approve" | "deny" | "injected" | "failed",
  opts?: { finalCommand?: string; error?: string },
): TerminalProposal | null {
  prune();
  const p = proposals.get(id);
  if (!p) return null;
  if (action === "approve") {
    if (p.status !== "pending") return p;
    p.status = "approved";
    p.finalCommand = opts?.finalCommand?.trim() || p.command;
    p.resolvedAt = Date.now();
  } else if (action === "deny") {
    if (p.status !== "pending" && p.status !== "approved") return p;
    p.status = "denied";
    p.resolvedAt = Date.now();
  } else if (action === "failed") {
    if (p.status === "denied" || p.status === "expired") return p;
    p.status = "failed";
    p.finalCommand = opts?.finalCommand?.trim() || p.finalCommand || p.command;
    p.error = opts?.error ?? "Inject failed";
    p.resolvedAt = Date.now();
  } else {
    // injected — only from pending/approved; never overwrite deny/expire/fail
    if (p.status !== "pending" && p.status !== "approved") return p;
    p.status = "injected";
    p.finalCommand = opts?.finalCommand?.trim() || p.finalCommand || p.command;
    p.error = opts?.error;
    p.resolvedAt = Date.now();
  }
  return p;
}
