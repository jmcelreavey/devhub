import fs from "node:fs";
import type { PaseoWorkspace } from "@getpaseo/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { withPaseo } from "./client";

/**
 * Worktrees and loose folders are disposable; a checkout is the user's repo and
 * is never reaped, even when its workspace looks idle.
 */
const DISPOSABLE_KINDS: ReadonlySet<PaseoWorkspace["workspaceKind"]> = new Set(["worktree", "directory"]);
const PAGE_SIZE = 200;
const SWEEP_INTERVAL_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const DEFAULT_STALE_DAYS = 7;

export interface PaseoSweepResult {
  workspacesArchived: number;
  projectsRemoved: number;
  staleArchived: number;
}

/** Days of quiet before a finished chat leaves the sidebar. 0 turns the tidy-up off. */
export function staleDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DEVHUB_PASEO_STALE_DAYS?.trim();
  if (!raw) return DEFAULT_STALE_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_STALE_DAYS;
}

/** Whether the folder behind a workspace is gone, which is the only evidence we act on. */
function folderIsGone(workspace: PaseoWorkspace): boolean {
  if (!DISPOSABLE_KINDS.has(workspace.workspaceKind) || !workspace.workspaceDirectory) return false;
  return !fs.existsSync(workspace.workspaceDirectory);
}

/**
 * A finished chat nobody has touched for a while. Archiving it only hides it
 * from the sidebar (Paseo's History still finds it and can unarchive it), but
 * a worktree workspace is different: Paseo deletes an owned worktree on archive,
 * so those are left to the worktree cleanup, which checks the work is done.
 */
function isStale(workspace: PaseoWorkspace, chats: ChatActivity | undefined, cutoff: number): boolean {
  if (workspace.workspaceKind === "worktree" || workspace.pinnedAt || workspace.archivingAt) return false;
  // Running or waiting on the user is live work.
  if (workspace.status !== "done" && workspace.status !== "failed") return false;
  if (workspace.scripts.some((script) => script.lifecycle === "running")) return false;
  // No chat, or no readable time, is no evidence of age.
  return Boolean(chats && !chats.live && chats.lastActiveAt > 0 && chats.lastActiveAt < cutoff);
}

interface ChatActivity {
  lastActiveAt: number;
  /** An agent here is running, initializing, or waiting on the user. */
  live: boolean;
}

/**
 * Paseo leaves a workspace's own `activityAt` empty, so age comes from the
 * chats in it: the latest time any of them was updated or messaged.
 */
async function chatActivityByWorkspace(daemon: DaemonClient): Promise<Map<string, ChatActivity>> {
  const byWorkspace = new Map<string, ChatActivity>();
  let cursor: string | undefined;
  do {
    const page = await daemon.fetchAgents({ page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    for (const { agent } of page.entries) {
      if (!agent.workspaceId) continue;
      const seen = byWorkspace.get(agent.workspaceId) ?? { lastActiveAt: 0, live: false };
      const times = [agent.updatedAt, agent.lastUserMessageAt].map((value) => (value ? Date.parse(value) : 0));
      seen.lastActiveAt = Math.max(seen.lastActiveAt, ...times.filter(Number.isFinite));
      seen.live ||= agent.status === "running" || agent.status === "initializing" || agent.requiresAttention || agent.pendingPermissions.length > 0;
      byWorkspace.set(agent.workspaceId, seen);
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return byWorkspace;
}

async function fetchAllWorkspaces(daemon: DaemonClient): Promise<PaseoWorkspace[]> {
  const workspaces: PaseoWorkspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await daemon.fetchWorkspaces({ page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    workspaces.push(...page.entries);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return workspaces;
}

/**
 * Keeps Paseo's sidebar about live work.
 *
 * - Removing a worktree (or Paseo removing one when a task ends) leaves a
 *   workspace pointing at nothing, and every worktree gets its own project, so
 *   the sidebar fills with dead rows. Archive those, and drop a project once
 *   every workspace under it went with it.
 * - Finished chats idle for `staleDays()` are archived too, so the sidebar
 *   shows recent work and History is where the rest is searched.
 *
 * Folders that exist are never touched, so this is safe to call at any time.
 */
export async function sweepPaseoWorkspaces(now = Date.now(), env: Record<string, string | undefined> = process.env): Promise<PaseoSweepResult> {
  return withPaseo(async ({ daemon }) => {
    const workspaces = await fetchAllWorkspaces(daemon);
    const result: PaseoSweepResult = { workspacesArchived: 0, projectsRemoved: 0, staleArchived: 0 };

    const byProject = new Map<string, PaseoWorkspace[]>();
    for (const workspace of workspaces) {
      byProject.set(workspace.projectId, [...(byProject.get(workspace.projectId) ?? []), workspace]);
    }

    const handled = new Set<string>();
    for (const [projectId, members] of byProject) {
      const orphaned = members.filter(folderIsGone);
      if (orphaned.length === 0) continue;
      try {
        if (orphaned.length === members.length) {
          const { removedWorkspaceIds } = await daemon.removeProject(projectId);
          result.projectsRemoved += 1;
          result.workspacesArchived += removedWorkspaceIds.length;
        } else {
          for (const workspace of orphaned) {
            await daemon.archiveWorkspace(workspace.id);
            result.workspacesArchived += 1;
          }
        }
        for (const workspace of orphaned) handled.add(workspace.id);
      } catch (error) {
        // One stuck project must not stop the rest; the next sweep retries it.
        console.error(`[paseo] could not clean up project ${projectId}`, error);
      }
    }

    const days = staleDays(env);
    if (days === 0) return result;
    const cutoff = now - days * DAY_MS;
    const chats = await chatActivityByWorkspace(daemon);
    for (const workspace of workspaces) {
      if (handled.has(workspace.id) || !isStale(workspace, chats.get(workspace.id), cutoff)) continue;
      try {
        await daemon.archiveWorkspace(workspace.id);
        result.staleArchived += 1;
      } catch (error) {
        console.error(`[paseo] could not archive idle workspace ${workspace.id}`, error);
      }
    }
    return result;
  });
}

/**
 * Best-effort sweep for callers whose real job is something else (removing a
 * worktree). Paseo being down must never fail that job.
 */
export async function sweepPaseoWorkspacesQuietly(): Promise<void> {
  try {
    await sweepPaseoWorkspaces();
  } catch {
    // The reconcile tick sweeps again.
  }
}

let lastSweepAt = 0;

/** For the reconcile tick, which runs every few seconds: sweeps at most every ten minutes. */
export async function sweepPaseoWorkspacesIfDue(now = Date.now()): Promise<void> {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  await sweepPaseoWorkspacesQuietly();
}
