import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mcpHttpAutostartEnabled,
  mcpHttpEntry,
  mcpHttpPort,
  stalePeerPids,
  type PortListener,
} from "@/lib/mcp-http-peer";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-peer-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mcpHttpPort", () => {
  it("uses DEVHUB_MCP_HTTP_PORT when valid, else 1340", () => {
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "1441" })).toBe(1441);
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "nope" })).toBe(1340);
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "70000" })).toBe(1340);
    expect(mcpHttpPort({})).toBe(1340);
  });
});

describe("mcpHttpAutostartEnabled", () => {
  it("is on by default and off for DEVHUB_MCP_HTTP=0 or tests", () => {
    expect(mcpHttpAutostartEnabled({})).toBe(true);
    expect(mcpHttpAutostartEnabled({ DEVHUB_MCP_HTTP: "0" })).toBe(false);
    expect(mcpHttpAutostartEnabled({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("stalePeerPids", () => {
  const entry = "/repo/mcp-servers/devhub-server/src/http.ts";
  const tsx = `node /repo/mcp-servers/devhub-server/node_modules/.bin/tsx ${entry}`;
  const peer = (overrides: Partial<PortListener> & { env?: string }): PortListener => ({
    pid: 200,
    commandAndEnv: `node --require preflight.cjs ${entry} ${overrides.env ?? ""}`,
    launcherPid: 199,
    launcherCommand: tsx,
    launcherParentPid: 100,
    ...overrides,
  });
  const alive = (livePids: number[]) => (pid: number) => livePids.includes(pid);

  it("replaces a peer whose dashboard is gone, with its tsx launcher", () => {
    expect(stalePeerPids([peer({ env: "DEVHUB_MCP_HTTP_PARENT_PID=100" })], entry, alive([]))).toEqual([200, 199]);
  });

  it("leaves a peer a live dashboard owns alone", () => {
    expect(stalePeerPids([peer({ env: "DEVHUB_MCP_HTTP_PARENT_PID=100" })], entry, alive([100]))).toEqual([]);
  });

  it("replaces a legacy peer (no parent pid) whose launcher launchd adopted", () => {
    expect(stalePeerPids([peer({ launcherParentPid: 1 })], entry, alive([]))).toEqual([200, 199]);
    expect(stalePeerPids([peer({ launcherPid: 1, launcherCommand: "/sbin/launchd", launcherParentPid: 0 })], entry, alive([]))).toEqual([200]);
  });

  it("leaves a legacy peer with a live launcher chain alone", () => {
    expect(stalePeerPids([peer({ launcherParentPid: 100 })], entry, alive([100]))).toEqual([]);
  });

  it("never touches a port that has anything else on it", () => {
    const foreign = peer({ pid: 300, commandAndEnv: "python -m http.server 1340" });
    expect(stalePeerPids([foreign], entry, alive([]))).toEqual([]);
    expect(stalePeerPids([peer({ env: "DEVHUB_MCP_HTTP_PARENT_PID=100" }), foreign], entry, alive([]))).toEqual([]);
    expect(stalePeerPids([], entry, alive([]))).toEqual([]);
  });
});

describe("mcpHttpEntry", () => {
  it("needs both the installed tsx and the HTTP entry", () => {
    const pkg = path.join(dir, "mcp-servers", "devhub-server");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "http.ts"), "");
    expect(mcpHttpEntry(dir)).toBeNull();

    fs.mkdirSync(path.join(pkg, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "node_modules", ".bin", "tsx"), "");
    expect(mcpHttpEntry(dir)).toEqual({
      tsx: path.join(pkg, "node_modules", ".bin", "tsx"),
      entry: path.join(pkg, "src", "http.ts"),
      cwd: pkg,
    });
  });
});
