import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "instrumentation-"));
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("DEVHUB_SCHEDULER", "0");
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));

  await register();

  expect(startShareExpiry).not.toHaveBeenCalled();
  fs.rmSync(root, { recursive: true, force: true });
});
