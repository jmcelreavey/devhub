import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configs: [] as { clientId: string }[], close: vi.fn(async () => undefined), connect: vi.fn(async () => undefined), fetchAgent: vi.fn() }));
vi.mock("@getpaseo/client", () => ({ createPaseoApi: () => ({}) }));
vi.mock("@getpaseo/client/internal/daemon-client", () => ({
  DaemonClient: class {
    connect = mocks.connect;
    fetchAgent = mocks.fetchAgent;
    close = mocks.close;
    constructor(config: { clientId: string }) { mocks.configs.push(config); }
  },
}));
import { paseoAgentWebUrl, paseoUrl, withPaseo } from "./client";

beforeEach(() => { vi.clearAllMocks(); mocks.configs.length = 0; });
afterEach(() => vi.unstubAllGlobals());
describe("Paseo connections", () => {
  it("opens the specific chat when its workspace contains multiple agents", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ serverId: "srv_local" })));
    mocks.fetchAgent.mockResolvedValue({ agent: { workspaceId: "wks_shared" } });
    const url = await paseoAgentWebUrl("agent-two", { NODE_ENV: "test" });
    expect(url).toBe("http://127.0.0.1:6767/h/srv_local/workspace/wks_shared?open=agent%3Aagent-two");
  });
  it("does not let concurrent operations replace each other's daemon session", async () => {
    await Promise.all([withPaseo(async () => 1), withPaseo(async () => 2)]);
    expect(new Set(mocks.configs.map(config => config.clientId)).size).toBe(2);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
  it("closes a failed operation and a failed connection", async () => {
    await expect(withPaseo(async () => { throw new Error("operation failed"); })).rejects.toThrow("operation failed");
    mocks.connect.mockRejectedValueOnce(new Error("authentication"));
    await expect(withPaseo(async () => 1)).rejects.toThrow("unavailable");
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
  it("refuses non-loopback daemons and invalid transports", () => {
    expect(() => paseoUrl({ NODE_ENV: "test", DEVHUB_PASEO_URL: "ws://example.com/ws" })).toThrow("loopback");
    expect(() => paseoUrl({ NODE_ENV: "test", DEVHUB_PASEO_URL: "https://127.0.0.1" })).toThrow("ws://");
  });
});
