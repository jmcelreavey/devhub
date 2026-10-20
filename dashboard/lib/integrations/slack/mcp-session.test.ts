import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), clients: vi.fn(), transports: vi.fn() }));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    constructor() { mocks.clients(); }
    connect = mocks.connect;
    close = mocks.close;
    listTools = mocks.listTools;
    callTool = mocks.callTool;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: class { constructor(options: unknown) { mocks.transports(options); } } }));
vi.mock("@/lib/content/dirs", () => ({ getDocsDir: () => "/tmp/docs", getNotesDir: () => "/tmp/notes", getTasksDir: () => "/tmp/tasks" }));
vi.mock("@/lib/dashboard-runtime", () => ({ buildRuntimeInfo: () => ({ baseUrl: "http://localhost:1337" }) }));
vi.mock("@/lib/desktop/runtime-paths", () => ({ getCheckoutRoot: () => "/tmp/devhub" }));
vi.mock("@/lib/mcp-http-peer", () => ({ mcpHttpEntry: () => ({ tsx: "/tmp/tsx", cwd: "/tmp/devhub/mcp-servers/devhub-server" }) }));
vi.mock("@/lib/process-env", () => ({ augmentedPathEnv: () => ({}), scrubDesktopRuntimeEnv: () => ({}) }));

import { createStdioMcpSession } from "./mcp-catalog";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.listTools.mockResolvedValue({ tools: [{ name: "notes_list" }] });
  mocks.callTool.mockResolvedValue({ content: [{ type: "text", text: "Existing text" }], structuredContent: { authored: [], reviews: [] } });
});

describe("Slack's stdio MCP adapter", () => {
  it("shares one connection across concurrent calls and keeps the profile scoped", async () => {
    const session = createStdioMcpSession("personal");
    await Promise.all([session.listTools(), session.callTool("prs_list", {})]);
    expect(mocks.clients).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.transports).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ DEVHUB_PROFILE: "personal", DEVHUB_BASE_URL: "http://localhost:1337" }) }));
    await session.close();
  });
  it("preserves the old text and adds structured content without forwarding embedded resources", async () => {
    const session = createStdioMcpSession("work");
    mocks.callTool.mockResolvedValueOnce({ content: [{ type: "text", text: "First" }, { type: "resource", resource: { text: "<html>not Slack</html>" } }, { type: "text", text: "Second" }], structuredContent: { authored: [{ draft: true }], reviews: [] } });
    expect(await session.callTool("prs_list", {})).toEqual({ text: "First\nSecond", isError: false, structuredContent: { authored: [{ draft: true }], reviews: [] } });
    await session.close();
  });
  it("reads every page of tools rather than limiting the Slack catalog", async () => {
    mocks.listTools.mockResolvedValueOnce({ tools: [{ name: "first" }], nextCursor: "page-two" }).mockResolvedValueOnce({ tools: [{ name: "last" }] });
    const session = createStdioMcpSession("work");
    expect(await session.listTools()).toEqual([{ name: "first" }, { name: "last" }]);
    expect(mocks.listTools).toHaveBeenLastCalledWith({ cursor: "page-two" });
    await session.close();
  });
  it("closes a failed handshake without retrying the original request", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Handshake failed"));
    const session = createStdioMcpSession("work");
    await expect(session.callTool("notes_write", {})).rejects.toThrow("Handshake failed");
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.callTool).not.toHaveBeenCalled();
    await session.close();
  });
  it("cannot leak a connection that completes after shutdown", async () => {
    let finish: (() => void) | undefined;
    mocks.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const session = createStdioMcpSession("work");
    const pending = session.listTools();
    const rejected = expect(pending).rejects.toThrow("connection is closed");
    const stopping = session.close();
    finish!();
    await Promise.all([rejected, stopping]);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.listTools).not.toHaveBeenCalled();
    await expect(session.listTools()).rejects.toThrow("connection is closed");
  });
});
