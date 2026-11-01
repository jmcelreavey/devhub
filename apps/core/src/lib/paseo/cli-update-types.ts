import { PASEO_CLI_LABELS } from "../../../../../packages/shared/actions/paseo";
export const AGENT_CLI_LABELS = PASEO_CLI_LABELS;
export type AgentCliLabel = typeof AGENT_CLI_LABELS[number];
export interface CliUpdateHistory {
  at: number;
  agent: string;
  status: "updated" | "failed" | "deferred" | "skipped";
  message: string;
}
export interface CliUpdateState {
  lastAttemptAt: number;
  enabled: boolean;
  pinned: string[];
  skippedUntil: Record<string, number>;
  history: CliUpdateHistory[];
}
export interface CliUpdateStatus extends CliUpdateState {
  checkedAt: number;
  installed: string[];
  lock: { held: boolean; ownerPid?: number; recoverable: boolean };
}
