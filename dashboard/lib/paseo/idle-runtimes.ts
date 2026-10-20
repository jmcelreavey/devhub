import type { PaseoAgent } from "@getpaseo/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { listAgentRuns, type AgentRun } from "@/lib/agent-runs/store";
import { paseoUrl, withPaseo } from "./client";

/**
 * Paseo keeps every chat it has loaded alive until the chat is archived: an idle
 * Codex chat holds its `codex app-server` and every MCP server that app-server
 * started (DevHub, plugin and playwriter servers). Paseo has no
 * "unload" short of archiving, so chats DevHub started are archived once they
 * have sat idle for a while. That only moves them to Paseo's History; sending
 * the chat another message (Continue, Reopen, a plan revision) unarchives it
 * and resumes the same conversation.
 */
const DEFAULT_IDLE_MINUTES = 15;
const SWEEP_INTERVAL_MS = 2 * 60_000;
const PAGE_SIZE = 200;
const MINUTE_MS = 60_000;

/** Minutes a finished DevHub chat stays loaded in Paseo. 0 turns the release off. */
export function idleReleaseMinutes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DEVHUB_PASEO_IDLE_RELEASE_MINUTES?.trim();
  if (!raw) return DEFAULT_IDLE_MINUTES;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_IDLE_MINUTES;
}

function lastActiveAt(agent: PaseoAgent): number {
  const times = [agent.updatedAt, agent.lastUserMessageAt].map((value) => (value ? Date.parse(value) : 0));
  return Math.max(0, ...times.filter(Number.isFinite));
}

/** Idle, nobody waiting on it, and untouched since the cutoff. Closed chats hold no runtime. */
export function agentRuntimeIsReleasable(agent: PaseoAgent, cutoff: number): boolean {
  if (agent.archivedAt || agent.status !== "idle") return false;
  if (agent.requiresAttention || agent.pendingPermissions.length > 0) return false;
  const active = lastActiveAt(agent);
  return active > 0 && active < cutoff;
}

interface OwnedChats {
  /** Chats a DevHub run on this connection started. */
  owned: Set<string>;
  /** Chats a DevHub run is still following, or finished too recently. */
  busy: Set<string>;
}

export function devhubOwnedChats(runs: readonly AgentRun[], connectionId: string, cutoff: number): OwnedChats {
  const owned = new Set<string>();
  const busy = new Set<string>();
  for (const run of runs) {
    const chatId = run.status.conversationId;
    if (run.spec.runtime !== "paseo" || !chatId || run.status.connectionId !== connectionId) continue;
    owned.add(chatId);
    if (isActiveAgentRunState(run.status.state) || (run.status.finishedAt ?? 0) >= cutoff) busy.add(chatId);
  }
  return { owned, busy };
}

async function fetchAllAgents(daemon: DaemonClient): Promise<PaseoAgent[]> {
  const agents: PaseoAgent[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await daemon.fetchAgents({ page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    agents.push(...page.entries.map((entry) => entry.agent));
    if (!page.pageInfo.hasMore) break;
    const next = page.pageInfo.nextCursor;
    if (!next || cursors.has(next)) break;
    cursors.add(next);
    cursor = next;
  } while (cursor);
  return agents;
}

export interface IdleReleaseResult {
  released: string[];
}

/**
 * Archives DevHub-started Paseo chats idle for `idleReleaseMinutes()`, freeing
 * their provider process and its MCP servers. Chats the user started in Paseo
 * are never touched.
 */
export async function releaseIdlePaseoRuntimes(
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
  runs: () => readonly AgentRun[] = () => listAgentRuns(Number.MAX_SAFE_INTEGER),
): Promise<IdleReleaseResult> {
  const minutes = idleReleaseMinutes(env);
  if (minutes === 0) return { released: [] };
  const cutoff = now - minutes * MINUTE_MS;
  const connectionId = paseoUrl(env as NodeJS.ProcessEnv);
  const { owned } = devhubOwnedChats(runs(), connectionId, cutoff);
  if (owned.size === 0) return { released: [] };
  return withPaseo(async ({ daemon }) => {
    const released: string[] = [];
    for (const agent of await fetchAllAgents(daemon)) {
      if (!owned.has(agent.id) || !agentRuntimeIsReleasable(agent, cutoff)) continue;
      // Re-check right before archiving: archiving cancels a turn, so a chat DevHub
      // (or the user) just sent a message to must be left alone.
      if (devhubOwnedChats(runs(), connectionId, cutoff).busy.has(agent.id)) continue;
      try {
        const fresh = await daemon.fetchAgent(agent.id);
        if (!fresh || !agentRuntimeIsReleasable(fresh.agent, cutoff)) continue;
        await daemon.archiveAgent(agent.id);
        released.push(agent.id);
      } catch (error) {
        console.error(`[paseo] could not release idle chat ${agent.id}`, error);
      }
    }
    return { released };
  }, env as NodeJS.ProcessEnv);
}

let lastReleaseAt = 0;

/** For the reconcile tick, which runs every few seconds: checks at most every two minutes. Never throws. */
export async function releaseIdlePaseoRuntimesIfDue(now = Date.now()): Promise<void> {
  if (now - lastReleaseAt < SWEEP_INTERVAL_MS) return;
  lastReleaseAt = now;
  try {
    const { released } = await releaseIdlePaseoRuntimes(now);
    if (released.length) console.log(`[paseo] released ${released.length} idle chat runtime(s)`);
  } catch {
    // Paseo down: the next tick retries.
  }
}
