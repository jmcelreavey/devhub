import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aionui/session", () => ({
  currentAionSession: async () => ({ origin: "http://127.0.0.1:25818", userId: "u", anchorConversationId: "a", accessToken: "t", csrfToken: "c", refreshToken: "r", authenticatedAt: 1 }),
}));

const list = vi.fn();
const toggle = vi.fn();
const update = vi.fn();
const importServers = vi.fn();
vi.mock("@/lib/aionui/client", () => ({
  AionClient: class {
    listMcpServers = list;
    toggleMcpServer = toggle;
    updateMcpServer = update;
    importMcpServers = importServers;
    deleteMcpServer = vi.fn();
  },
}));

describe("syncAionMcpServers", () => {
  it("enables DevHub-managed servers after sync", async () => {
    list.mockResolvedValue([
      { id: "1", name: "devhub", description: "[DevHub managed] tools", enabled: false, builtin: false },
      { id: "2", name: "other", description: "manual", enabled: false, builtin: false },
    ]);
    toggle.mockResolvedValue({ id: "1", name: "devhub", enabled: true });
    const { syncAionMcpServers } = await import("./aionui-mcp");
    const lines: string[] = [];
    const servers = new Map([
      ["devhub", { command: "echo", description: "tools" } as never],
    ]);
    await syncAionMcpServers(servers, { emit: (l) => lines.push(l) });
    expect(update).toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledWith("1");
    expect(toggle).not.toHaveBeenCalledWith("2");
    expect(lines.some((l) => l.includes("ENABLED: devhub") || l.includes("enabled"))).toBe(true);
  });


  it("pins Cursor ACP env onto AionUi DevHub and lean-ctx transports", async () => {
    list.mockResolvedValue([]);
    importServers.mockResolvedValue(undefined);
    const { syncAionMcpServers } = await import("./aionui-mcp");
    await syncAionMcpServers(
      new Map([
        ["devhub", { command: "echo", env: { NOTES_DIR: "/notes" }, description: "tools" }],
        ["lean-ctx", { command: "/opt/lean-ctx" }],
      ]),
      { emit: () => undefined },
    );
    const bodies = importServers.mock.calls.flatMap((call) => call[0] as Array<Record<string, unknown>>);
    const byName = Object.fromEntries(bodies.map((row) => [row.name as string, row]));
    const devhubEnv = (byName.devhub.transport as { env: Record<string, string> }).env;
    const leanEnv = (byName["lean-ctx"].transport as { env: Record<string, string> }).env;
    expect(devhubEnv.NOTES_DIR).toBe("/notes");
    expect(devhubEnv.DEVHUB_MCP_TOOLSETS).toContain("notes");
    expect(leanEnv.LEAN_CTX_TOOL_PROFILE).toBe("standard");
  });
});
