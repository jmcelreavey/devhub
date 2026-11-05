import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ withPaseo: (fn: (session: unknown) => unknown) => fn({ daemon }) }));

import { loadPaseoWorktreeActivity } from "./workspaces";

const daemon = {
  fetchAgents: vi.fn(),
  fetchWorkspaces: vi.fn(),
};

describe("checkout activity", () => {
  it("ignores finished chats but keeps running agents and pending permissions protected", async () => {
    const workspace = { id: "workspace", workspaceDirectory: "/repo", status: "active", scripts: [] };
    daemon.fetchWorkspaces.mockResolvedValue({ entries: [workspace], pageInfo: { hasMore: false } });
    const agent = { workspaceId: workspace.id, status: "idle", requiresAttention: true, attentionReason: "finished", pendingPermissions: [] };
    daemon.fetchAgents.mockResolvedValue({ entries: [{ agent }], pageInfo: { hasMore: false } });
    expect(await loadPaseoWorktreeActivity({ ignoreIdlePins: true })).toMatchObject([{ active: false }]);

    agent.status = "running";
    expect(await loadPaseoWorktreeActivity({ ignoreIdlePins: true })).toMatchObject([{ active: true }]);
    agent.status = "idle";
    agent.pendingPermissions.push({} as never);
    expect(await loadPaseoWorktreeActivity({ ignoreIdlePins: true })).toMatchObject([{ active: true }]);
  });
});
