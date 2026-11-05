import type { PaseoWorkspace } from "@getpaseo/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { withPaseo } from "./client";

const PAGE_SIZE = 200;
interface ChatActivity {
  lastActiveAt: number;
  /** An agent here is running, initializing, or waiting on the user. */
  live: boolean;
  checkoutLive: boolean;
}

/**
 * Paseo leaves a workspace's own `activityAt` empty, so age comes from the
 * chats in it: the latest time any of them was updated or messaged.
 */
function nextPageCursor(info: { hasMore: boolean; nextCursor?: string | null }, seen: Set<string>): string | undefined {
  if (!info.hasMore) return undefined;
  if (!info.nextCursor || seen.has(info.nextCursor)) throw new Error("Paseo pagination is incomplete; cannot verify activity.");
  seen.add(info.nextCursor);
  return info.nextCursor;
}

async function chatActivityByWorkspace(daemon: DaemonClient): Promise<Map<string, ChatActivity>> {
  const byWorkspace = new Map<string, ChatActivity>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await daemon.fetchAgents({ page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    for (const { agent } of page.entries) {
      if (!agent.workspaceId) continue;
      const seen = byWorkspace.get(agent.workspaceId) ?? { lastActiveAt: 0, live: false, checkoutLive: false };
      const times = [agent.updatedAt, agent.lastUserMessageAt].map((value) => (value ? Date.parse(value) : 0));
      seen.lastActiveAt = Math.max(seen.lastActiveAt, ...times.filter(Number.isFinite));
      seen.live ||= agent.status === "running" || agent.status === "initializing" || agent.requiresAttention || agent.pendingPermissions.length > 0;
      seen.checkoutLive ||= agent.status === "running" || agent.status === "initializing" || (agent.requiresAttention && agent.attentionReason !== "finished") || agent.pendingPermissions.length > 0;
      byWorkspace.set(agent.workspaceId, seen);
    }
    cursor = nextPageCursor(page.pageInfo, cursors);
  } while (cursor);
  return byWorkspace;
}

export async function loadPaseoWorktreeActivity(options: { ignoreIdlePins?: boolean } = {}): Promise<Array<{ path: string; active: boolean; updatedAt: number }>> {
  return withPaseo(async ({ daemon }) => {
    const chats = await chatActivityByWorkspace(daemon);
    return (await fetchAllWorkspaces(daemon)).flatMap((workspace) => workspace.workspaceDirectory ? [{
      path: workspace.workspaceDirectory,
      active: Boolean((!options.ignoreIdlePins && workspace.pinnedAt) || workspace.archivingAt || (options.ignoreIdlePins ? chats.get(workspace.id)?.checkoutLive : chats.get(workspace.id)?.live) ||
        workspace.scripts.some((script) => script.lifecycle === "running") ||
        ((!options.ignoreIdlePins || !chats.has(workspace.id)) && workspace.status !== "done" && workspace.status !== "failed")),
      updatedAt: chats.get(workspace.id)?.lastActiveAt ?? 0,
    }] : []);
  });
}

async function fetchAllWorkspaces(daemon: DaemonClient): Promise<PaseoWorkspace[]> {
  const workspaces: PaseoWorkspace[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await daemon.fetchWorkspaces({ page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    workspaces.push(...page.entries);
    cursor = nextPageCursor(page.pageInfo, cursors);
  } while (cursor);
  return workspaces;
}
