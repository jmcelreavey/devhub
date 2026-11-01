/**
 * Lifecycle of an interactive CLI run from inside its terminal tab.
 *
 * The dock runs `start <dir> $$; <cli>; finish <dir> $?`. `start` records the
 * tab's shell pid, so closing the tab (shell dies) is caught by the store's
 * dead-pid reconcile like any headless run; `finish` records the CLI's exit.
 * Neither relies on the model remembering to call `agent_interactive_finish`.
 *
 * Imports only run-files so the bundled runner stays small.
 */
import {
  isActiveAgentRunState,
  readRunSpec,
  readRunStatus,
  writeRunStatus,
  type AgentRunState,
  type AgentRunStatus,
} from "./run-files";

/** Exit 130 is Ctrl+C — the user quitting the TUI, not the agent failing. */
export function interactiveStateForExit(code: number): AgentRunState {
  if (code === 0) return "succeeded";
  if (code === 130) return "cancelled";
  return "failed";
}

function readInteractive(dir: string): { id: string; status: AgentRunStatus } | null {
  const spec = readRunSpec(dir);
  const status = readRunStatus(dir);
  if (!spec || !status || spec.bin !== "interactive") return null;
  return { id: spec.id, status };
}

/** Bind the run to the tab's shell. No-op once the run has finished. */
export function attachInteractiveShell(dir: string, pid: number): AgentRunStatus | null {
  const run = readInteractive(dir);
  if (!run || !isActiveAgentRunState(run.status.state) || !Number.isInteger(pid) || pid <= 1) return null;
  return writeRunStatus(dir, { ...run.status, state: "running", pid, startedAt: run.status.startedAt ?? Date.now() });
}

/**
 * Record the CLI's exit. A run the agent already finished via MCP keeps its
 * richer result; this only closes runs that are still open.
 */
export function finishInteractiveFromExit(
  dir: string,
  exitCode: number,
): { id: string; status: AgentRunStatus } | null {
  const run = readInteractive(dir);
  if (!run || !isActiveAgentRunState(run.status.state)) return null;
  const state = interactiveStateForExit(exitCode);
  const status = writeRunStatus(dir, {
    ...run.status,
    state,
    // The shell outlives the CLI — drop the pid so reconcile never re-judges it.
    pid: undefined,
    exitCode,
    finishedAt: Date.now(),
    error: state === "failed" ? (run.status.error ?? `CLI exited with code ${exitCode}`) : run.status.error,
  });
  return { id: run.id, status };
}
