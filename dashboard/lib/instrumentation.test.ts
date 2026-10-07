import { afterEach, expect, it, vi } from "vitest";
import { register } from "../instrumentation";
import { startShareExpiry } from "./share/share-expiry";

vi.mock("./share/share-expiry", () => ({ startShareExpiry: vi.fn() }));
vi.mock("./scheduler-log", () => ({ appendSchedulerLog: vi.fn() }));
vi.mock("./mcp-http-peer", () => ({ startMcpHttpPeer: vi.fn(async () => {}) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("keeps shared-link expiry with the primary dashboard", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("DEVHUB_SCHEDULER", "0");

  await register();

  expect(startShareExpiry).not.toHaveBeenCalled();
});
