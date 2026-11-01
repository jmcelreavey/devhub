import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { orphanMcpPids, parsePsRows, reapOrphanMcpServers } from "./reap-orphan-mcp";

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it("only selects orphaned DevHub stdio servers and their matching descendants", () => {
  const rows = parsePsRows([
    "101 1 node /checkout/packages/mcp/bin/devhub-mcp.mjs",
    "102 101 node /checkout/mcp-servers/devhub-example-server/src/server.ts",
    "103 1 node /checkout/packages/mcp/src/http.ts",
    "104 1 python /checkout/mcp-servers/devhub-server/src/server.ts",
    "105 400 node /checkout/mcp-servers/devhub-server/src/server.ts",
    "106 1 node /checkout/mcp-servers/other-server/src/server.ts",
    "107 101 python /checkout/mcp-servers/devhub-server/src/server.ts",
    "108 1 node /checkout/mcp-servers/devhub-server/bin/devhub-mcp.mjs",
    "109 1 node /checkout/mcp-servers/devhub-server/src/http.ts",
  ].join("\n"));

  expect(orphanMcpPids(rows, 999)).toEqual([101, 102, 108]);
  expect(orphanMcpPids(rows, 101)).toEqual([108]);
});

it.skipIf(process.platform === "win32")("rechecks asynchronous process lists before escalating", async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  const rows = parsePsRows([
    "101 1 node /checkout/packages/mcp/bin/devhub-mcp.mjs",
    "102 1 node /checkout/mcp-servers/devhub-example-server/src/server.ts",
  ].join("\n"));
  const list = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[0]]);

  const reaping = reapOrphanMcpServers(() => undefined, list);
  await Promise.resolve();
  expect(kill).toHaveBeenCalledWith(101, "SIGTERM");
  expect(kill).toHaveBeenCalledWith(102, "SIGTERM");
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await reaping).toEqual([101, 102]);
  expect(kill).toHaveBeenCalledWith(101, "SIGKILL");
  expect(kill).not.toHaveBeenCalledWith(102, "SIGKILL");
});

it.skipIf(process.platform === "win32")("keeps the dashboard responsive while scanning processes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-reap-"));
  directories.push(directory);
  const ready = path.join(directory, "ready");
  fs.writeFileSync(path.join(directory, "ps"), [
    "#!/bin/sh",
    "attempt=0",
    'while [ ! -f "$MCP_REAP_TEST_READY" ] && [ "$attempt" -lt 100 ]; do',
    "  sleep 0.01",
    "  attempt=$((attempt + 1))",
    "done",
    '[ -f "$MCP_REAP_TEST_READY" ] || exit 1',
    "",
  ].join("\n"), { mode: 0o700 });
  vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
  vi.stubEnv("MCP_REAP_TEST_READY", ready);

  let progressed = false;
  const timer = setTimeout(() => {
    progressed = true;
    fs.writeFileSync(ready, "ready");
  }, 30);
  try {
    expect(await reapOrphanMcpServers()).toEqual([]);
    expect(progressed).toBe(true);
  } finally {
    clearTimeout(timer);
  }
}, 10_000);
