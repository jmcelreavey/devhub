import { describe, expect, it, vi } from "vitest";
import { isDevhubMcpCommand, orphanMcpPids, parsePsRows, reapOrphanMcpServers, type ProcessRow } from "./reap-orphan-mcp";

const RUNTIME = "/Applications/DevHub.app/Contents/Resources/runtime/node-aarch64-apple-darwin";
const REPO = "/Users/me/Developer/devhub-private";
const PLUGIN = "/Users/me/Developer/devhub-acme";
const tsxWrapper = `node ${REPO}/mcp-servers/devhub-server/node_modules/.bin/tsx ${REPO}/dashboard/lib/mcp/playwriter-compact.ts`;
const runtimeChild = `${RUNTIME} --require ${REPO}/mcp-servers/devhub-server/node_modules/tsx/dist/preflight.cjs --import file:///x ${REPO}/dashboard/lib/mcp/playwriter-compact.ts`;
const biChild = `${RUNTIME} --require ${PLUGIN}/mcp-servers/devhub-acme-server/node_modules/tsx/dist/preflight.cjs --import file:///x ${PLUGIN}/mcp-servers/devhub-acme-server/src/mcp.ts`;
const mcpBin = `node ${REPO}/mcp-servers/devhub-server/bin/devhub-mcp.mjs`;
const httpPeer = `node ${REPO}/mcp-servers/devhub-server/node_modules/.bin/tsx ${REPO}/mcp-servers/devhub-server/src/http.ts`;

describe("isDevhubMcpCommand", () => {
  it.each([[tsxWrapper], [runtimeChild], [biChild], [mcpBin]])("matches %s", (command) => {
    expect(isDevhubMcpCommand(command)).toBe(true);
  });
  it.each([
    ["the HTTP peer", httpPeer],
    ["a wrapper around the server", `/Applications/Claude.app/Contents/Helpers/disclaimer --pgroup -- ${REPO}/mcp-servers/devhub-server/bin/devhub-mcp.mjs`],
    ["an unrelated node process", `node ${REPO}/dashboard/node_modules/.bin/vitest run`],
    ["the DevHub dashboard", `${RUNTIME} ${REPO}/dashboard/server.js`],
    ["an editor opening the source", `vim ${REPO}/mcp-servers/devhub-server/src/mcp.ts`],
  ])("skips %s", (_label, command) => {
    expect(isDevhubMcpCommand(command)).toBe(false);
  });
});

describe("orphanMcpPids", () => {
  const rows: ProcessRow[] = [
    // Orphaned tsx wrapper and its runtime child.
    { pid: 10, ppid: 1, command: tsxWrapper },
    { pid: 11, ppid: 10, command: runtimeChild },
    // Orphaned runtime child directly under launchd.
    { pid: 20, ppid: 1, command: biChild },
    // Live: parent is a running codex app-server.
    { pid: 30, ppid: 500, command: tsxWrapper },
    { pid: 31, ppid: 30, command: runtimeChild },
    // Orphaned HTTP peer: left to its own handling.
    { pid: 40, ppid: 1, command: httpPeer },
    // A non-matching child of an orphan is never touched.
    { pid: 12, ppid: 10, command: "/usr/bin/npx -y playwriter@latest" },
    { pid: 500, ppid: 1, command: "/opt/homebrew/bin/codex app-server" },
  ];

  it("returns orphaned servers and their matching descendants only", () => {
    expect(orphanMcpPids(rows, 999).sort((a, b) => a - b)).toEqual([10, 11, 20]);
  });

  it("never returns its own pid", () => {
    expect(orphanMcpPids(rows, 20)).not.toContain(20);
  });
});

describe("parsePsRows", () => {
  it("parses pid, ppid and the full command", () => {
    expect(parsePsRows(`  10     1 ${tsxWrapper}\n\n 11 10 ${runtimeChild}\n`)).toEqual([
      { pid: 10, ppid: 1, command: tsxWrapper },
      { pid: 11, ppid: 10, command: runtimeChild },
    ]);
  });
});

describe("reapOrphanMcpServers", () => {
  it("does nothing when there are no orphans", async () => {
    const kill = vi.spyOn(process, "kill");
    await expect(reapOrphanMcpServers(() => undefined, () => [{ pid: 30, ppid: 500, command: tsxWrapper }])).resolves.toEqual([]);
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });

  it("terminates orphans and escalates only for ones still running the same server", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const list = vi.fn()
      .mockReturnValueOnce([{ pid: 10, ppid: 1, command: tsxWrapper }, { pid: 20, ppid: 1, command: biChild }])
      .mockReturnValueOnce([{ pid: 20, ppid: 1, command: biChild }]);
    const done = reapOrphanMcpServers(() => undefined, list);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(done).resolves.toEqual([10, 20]);
    expect(kill.mock.calls).toEqual([[10, "SIGTERM"], [20, "SIGTERM"], [20, "SIGKILL"]]);
    kill.mockRestore();
    vi.useRealTimers();
  });
});
