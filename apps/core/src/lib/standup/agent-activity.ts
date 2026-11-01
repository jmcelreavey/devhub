import {
  localDate,
  mcpHistoryDir,
  readMcpHistoryWindow,
  summarizeMcpHistory,
} from "../../../../../packages/shared/mcp-history/index.ts";
import type { StandupAgentActivity } from "./markdown";

const MAX_ACTIONS = 15;

/**
 * DevHub MCP calls inside the standup window, shaped for the standup's
 * "Agent activity" section. Null when nothing was recorded, so a standup from
 * a day without agents looks exactly as it did before.
 */
export function loadStandupAgentActivity(
  sinceMs: number,
  untilExclusiveMs: number,
  dir = mcpHistoryDir(),
): StandupAgentActivity | null {
  const entries = readMcpHistoryWindow(dir, sinceMs, untilExclusiveMs);
  if (entries.length === 0) return null;
  const summary = summarizeMcpHistory(localDate(sinceMs), entries);
  const actions = summary.actions.map(
    (a) => `${a.tool}${a.detail ? ` ${a.detail}` : ""}${a.ok ? "" : " (failed)"}`,
  );
  return {
    total: summary.total,
    failed: summary.failed,
    actions: actions.slice(0, MAX_ACTIONS),
    actionsTruncated: actions.length > MAX_ACTIONS,
  };
}
