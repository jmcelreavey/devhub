/**
 * Agent-run budgets: the caps a dispatch (and the runner) enforce, all env-
 * tunable because the right number is per-machine and per-mood.
 *
 * Recorded stats alone don't stop anything — these do:
 * - maxTurns    — per run, for providers that support a turn cap (Claude).
 * - maxSeconds  — wall clock; the runner kills the CLI past the deadline.
 * - maxCostUsd  — refuses NEW dispatches once the finished runs of the current
 *   local day have already spent this much. Cost only becomes known when a run
 *   ends, so mid-run cost cannot be enforced; blocking the next dispatch is
 *   the honest lever.
 * `0` disables a cap. Defaults are on (conservative) because races are cute
 * until three Claudes run uncapped.
 */
import type { AgentRun } from "./store";

export interface AgentBudgets {
  maxTurns: number;
  maxSeconds: number;
  maxCostUsd: number;
}

const DEFAULT_MAX_TURNS = 200;
const DEFAULT_MAX_SECONDS = 1_800;
const DEFAULT_MAX_COST_USD = 25;

function envInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function agentBudgets(env: NodeJS.ProcessEnv = process.env): AgentBudgets {
  return {
    maxTurns: envInt(env.DEVHUB_AGENT_MAX_TURNS, DEFAULT_MAX_TURNS),
    maxSeconds: envInt(env.DEVHUB_AGENT_MAX_SECONDS, DEFAULT_MAX_SECONDS),
    maxCostUsd: envInt(env.DEVHUB_AGENT_MAX_COST_USD, DEFAULT_MAX_COST_USD),
  };
}

/** The turn cap actually applied: caller's explicit choice wins over the env default. */
export function effectiveMaxTurns(requested: number | undefined, budgets: AgentBudgets): number | undefined {
  if (requested !== undefined) return requested;
  return budgets.maxTurns > 0 ? budgets.maxTurns : undefined;
}

/** Spent so far today across FINISHED runs (queued/running cost nothing yet). */
export function spentToday(runs: readonly AgentRun[], now = Date.now()): number {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return runs
    .filter(
      (run) =>
        run.status.finishedAt !== undefined &&
        run.status.finishedAt >= dayStart.getTime() &&
        typeof run.status.costUsd === "number",
    )
    .reduce((sum, run) => sum + (run.status.costUsd ?? 0), 0);
}

export function costRefusalMessage(spent: number, cap: number): string {
  return (
    `Agent run cost budget reached: $${spent.toFixed(2)} of today's $${cap.toFixed(2)} cap already spent. ` +
    "Finish or cancel runs, or raise DEVHUB_AGENT_MAX_COST_USD."
  );
}
