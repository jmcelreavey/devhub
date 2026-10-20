import { afterEach, expect, it, vi } from "vitest";
import type { SlackSettings } from "./shared";
const clients = vi.hoisted(() => ({ direct: vi.fn(() => ({ mode: "direct" })), gateway: vi.fn(() => ({ mode: "gateway" })) }));
vi.mock("./client", () => ({ createSlackClient: clients.direct }));
vi.mock("./gateway-client", () => ({ createGatewayClient: clients.gateway }));
import { createSlackTransport } from "./transport";
const settings: SlackSettings = { botToken: "xoxb-fake", appToken: "xapp-fake", allowedUserId: "U1", channelId: "D1", teamId: "T1" };
afterEach(() => vi.clearAllMocks());
it("uses today's Socket Mode unchanged when mode is absent or direct", () => {
  createSlackTransport(settings); createSlackTransport({ ...settings, mode: "direct" });
  expect(clients.direct).toHaveBeenCalledTimes(2); expect(clients.gateway).not.toHaveBeenCalled(); expect(clients.direct).toHaveBeenCalledWith(settings);
});
it("only opens a gateway transport when explicitly selected", () => {
  const selected = { ...settings, mode: "gateway" as const, gatewayUrl: "https://gateway.test" };
  createSlackTransport(selected);
  expect(clients.gateway).toHaveBeenCalledWith(selected); expect(clients.direct).not.toHaveBeenCalled();
});
