import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchAgents: vi.fn(),
  archiveWorkspace: vi.fn(),
  removeProject: vi.fn(),
}));

vi.mock("./client", () => ({
  withPaseo: (fn: (session: { daemon: typeof daemon }) => Promise<unknown>) => fn({ daemon }),
}));

import { staleDays, sweepPaseoWorkspaces, sweepPaseoWorkspacesQuietly } from "./workspaces";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const page = (entries: unknown[]) => ({ entries, pageInfo: { hasMore: false, nextCursor: null, prevCursor: null } });

let live: string;
const gone = "/definitely/not/here/worktree";

function workspace(id: string, projectId: string, workspaceKind: string, workspaceDirectory?: string, extra: Record<string, unknown> = {}) {
  return { id, projectId, workspaceKind, workspaceDirectory, status: "done", pinnedAt: null, archivingAt: null, scripts: [], ...extra };
}

function chat(workspaceId: string, updatedAt: string, extra: Record<string, unknown> = {}) {
  return { agent: { id: `agent-${workspaceId}`, workspaceId, updatedAt, lastUserMessageAt: null, status: "idle", requiresAttention: false, pendingPermissions: [], ...extra } };
}

function listing(...entries: ReturnType<typeof workspace>[]) {
  daemon.fetchWorkspaces.mockResolvedValue(page(entries));
}

const sweep = () => sweepPaseoWorkspaces(NOW, {});

beforeEach(() => {
  live = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-sweep-"));
  daemon.fetchWorkspaces.mockReset();
  daemon.fetchAgents.mockReset().mockResolvedValue(page([]));
  daemon.archiveWorkspace.mockReset().mockResolvedValue({});
  daemon.removeProject.mockReset().mockImplementation(async () => ({ removedWorkspaceIds: ["w"] }));
});

afterEach(() => fs.rmSync(live, { recursive: true, force: true }));

describe("sweepPaseoWorkspaces: missing folders", () => {
  it("removes a project whose only workspace lost its worktree", async () => {
    listing(workspace("w1", "p1", "worktree", gone));
    await expect(sweep()).resolves.toEqual({ workspacesArchived: 1, projectsRemoved: 1, staleArchived: 0 });
    expect(daemon.removeProject).toHaveBeenCalledWith("p1");
  });

  it("archives only the dead workspaces when the project still has live ones", async () => {
    listing(workspace("w1", "p1", "local_checkout", live), workspace("w2", "p1", "worktree", gone));
    await expect(sweep()).resolves.toEqual({ workspacesArchived: 1, projectsRemoved: 0, staleArchived: 0 });
    expect(daemon.archiveWorkspace).toHaveBeenCalledWith("w2");
    expect(daemon.removeProject).not.toHaveBeenCalled();
  });

  it("leaves worktrees that still exist alone", async () => {
    listing(workspace("w1", "p1", "worktree", live));
    await sweep();
    expect(daemon.archiveWorkspace).not.toHaveBeenCalled();
    expect(daemon.removeProject).not.toHaveBeenCalled();
  });

  it("never reaps a checkout, even when its folder looks missing", async () => {
    listing(workspace("w1", "p1", "local_checkout", gone), workspace("w2", "p2", "checkout", gone));
    await expect(sweep()).resolves.toEqual({ workspacesArchived: 0, projectsRemoved: 0, staleArchived: 0 });
  });

  it("keeps going when one project fails", async () => {
    listing(workspace("w1", "p1", "worktree", gone), workspace("w2", "p2", "worktree", gone));
    daemon.removeProject.mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce({ removedWorkspaceIds: ["w2"] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sweep()).resolves.toMatchObject({ workspacesArchived: 1, projectsRemoved: 1 });
  });

  it("follows pagination", async () => {
    daemon.fetchWorkspaces
      .mockResolvedValueOnce({ entries: [workspace("w1", "p1", "worktree", gone)], pageInfo: { hasMore: true, nextCursor: "c1", prevCursor: null } })
      .mockResolvedValueOnce(page([workspace("w2", "p2", "worktree", gone)]));
    await expect(sweep()).resolves.toMatchObject({ projectsRemoved: 2 });
    expect(daemon.fetchWorkspaces).toHaveBeenLastCalledWith({ page: { limit: 200, cursor: "c1" } });
  });

  it("quiet variant swallows a Paseo outage", async () => {
    daemon.fetchWorkspaces.mockRejectedValue(new Error("Paseo is unavailable."));
    await expect(sweepPaseoWorkspacesQuietly()).resolves.toBeUndefined();
  });
});

describe("sweepPaseoWorkspaces: idle chats", () => {
  const oldChat = (id: string, extra?: Record<string, unknown>) => chat(id, daysAgo(10), extra);

  it("archives a finished checkout chat idle past the window, keeping the project", async () => {
    listing(workspace("w1", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([oldChat("w1")]));
    await expect(sweep()).resolves.toEqual({ workspacesArchived: 0, projectsRemoved: 0, staleArchived: 1 });
    expect(daemon.archiveWorkspace).toHaveBeenCalledWith("w1");
    expect(daemon.removeProject).not.toHaveBeenCalled();
  });

  it("keeps a chat that was active inside the window", async () => {
    listing(workspace("w1", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([chat("w1", daysAgo(2))]));
    await expect(sweep()).resolves.toMatchObject({ staleArchived: 0 });
  });

  it("measures age from the newest chat or message in the workspace", async () => {
    listing(workspace("w1", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([
      oldChat("w1"),
      { agent: { ...oldChat("w1").agent, id: "second", lastUserMessageAt: daysAgo(1) } },
    ]));
    await expect(sweep()).resolves.toMatchObject({ staleArchived: 0 });
  });

  it.each([
    ["a worktree workspace, which Paseo deletes on archive", workspace("w1", "p1", "worktree", live)],
    ["a pinned workspace", workspace("w1", "p1", "local_checkout", live, { pinnedAt: daysAgo(30) })],
    ["a running workspace", workspace("w1", "p1", "local_checkout", live, { status: "running" })],
    ["a workspace waiting on the user", workspace("w1", "p1", "local_checkout", live, { status: "needs_input" })],
    ["a workspace with a running script", workspace("w1", "p1", "local_checkout", live, { scripts: [{ lifecycle: "running" }] })],
  ])("never archives %s", async (_label, target) => {
    listing(target);
    daemon.fetchAgents.mockResolvedValue(page([oldChat("w1")]));
    await expect(sweep()).resolves.toMatchObject({ staleArchived: 0 });
    expect(daemon.archiveWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    ["is running", { status: "running" }],
    ["needs attention", { requiresAttention: true }],
    ["has a pending permission", { pendingPermissions: [{}] }],
  ])("keeps a workspace whose chat %s", async (_label, extra) => {
    listing(workspace("w1", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([oldChat("w1", extra)]));
    await expect(sweep()).resolves.toMatchObject({ staleArchived: 0 });
  });

  it("keeps a workspace with no chats, since there is no age to go on", async () => {
    listing(workspace("w1", "p1", "local_checkout", live));
    await expect(sweep()).resolves.toMatchObject({ staleArchived: 0 });
  });

  it("does not archive a workspace twice when its folder was also gone", async () => {
    listing(workspace("w1", "p1", "directory", gone), workspace("w2", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([oldChat("w1"), oldChat("w2")]));
    await expect(sweep()).resolves.toEqual({ workspacesArchived: 1, projectsRemoved: 0, staleArchived: 1 });
    expect(daemon.archiveWorkspace.mock.calls.map(([id]) => id)).toEqual(["w1", "w2"]);
  });

  it("is switched off by DEVHUB_PASEO_STALE_DAYS=0", async () => {
    listing(workspace("w1", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([oldChat("w1")]));
    await expect(sweepPaseoWorkspaces(NOW, { DEVHUB_PASEO_STALE_DAYS: "0" })).resolves.toMatchObject({ staleArchived: 0 });
    expect(daemon.fetchAgents).not.toHaveBeenCalled();
  });

  it("keeps going when one archive fails", async () => {
    listing(workspace("w1", "p1", "local_checkout", live), workspace("w2", "p1", "local_checkout", live));
    daemon.fetchAgents.mockResolvedValue(page([oldChat("w1"), oldChat("w2")]));
    daemon.archiveWorkspace.mockRejectedValueOnce(new Error("busy"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sweep()).resolves.toMatchObject({ staleArchived: 1 });
  });
});

describe("staleDays", () => {
  it("defaults to a week and ignores junk", () => {
    expect(staleDays({})).toBe(7);
    expect(staleDays({ DEVHUB_PASEO_STALE_DAYS: "soon" })).toBe(7);
    expect(staleDays({ DEVHUB_PASEO_STALE_DAYS: "-3" })).toBe(7);
  });

  it("accepts a number of days, and 0 to disable", () => {
    expect(staleDays({ DEVHUB_PASEO_STALE_DAYS: "14" })).toBe(14);
    expect(staleDays({ DEVHUB_PASEO_STALE_DAYS: "0" })).toBe(0);
  });
});
