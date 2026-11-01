import { isDestructiveTerminalCommand } from "./command.ts";

/**
 * Auto-run skips the chip, but never for the destructive patterns
 * (`rm -rf`, `git push --force`, `kubectl delete`, …). An unattended inject is
 * exactly where those are least recoverable, so they keep their modal.
 */
export function shouldAutoRunProposal(opts: { autoRun: boolean; command: string }): boolean {
  if (!opts.autoRun) return false;
  return !isDestructiveTerminalCommand(opts.command);
}

export function shouldInjectProposal(opts: { autoRun: boolean; command: string; skipConfirm?: boolean; requiresConfirmation?: boolean }): boolean {
  // Server-authorised runs still need the destructive-command check.
  return !opts.requiresConfirmation && shouldAutoRunProposal({ autoRun: opts.skipConfirm === true || opts.autoRun, command: opts.command });
}

