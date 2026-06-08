import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listPersonalMcpServerNames, readPersonalMcpServer, writePersonalMcpServer } from "./mcp-personal";
import { syncMcpServers } from "./sync-mcp";

describe("mcp-personal", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it("writes and reads personal servers outside the repo", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-personal-home-"));
    process.env.HOME = home;
    writePersonalMcpServer(home, "agentmemory", {
      command: "npx",
      args: ["-y", "@agentmemory/mcp"],
      env: { AGENTMEMORY_URL: "http://localhost:3111" },
    });
    expect(listPersonalMcpServerNames(home)).toEqual(["agentmemory"]);
    const s = readPersonalMcpServer(home, "agentmemory");
    expect(s?.command).toBe("npx");
  });

  it("syncs personal servers to all tool configs without repo files", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-personal-repo-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-personal-home2-"));
    process.env.HOME = home;
    fs.mkdirSync(path.join(repo, "mcp", "shared"), { recursive: true });
    writePersonalMcpServer(home, "agentmemory", {
      command: "npx",
      args: ["-y", "@agentmemory/mcp"],
    });

    const lines: string[] = [];
    await syncMcpServers({ emit: (l) => lines.push(l), repoRoot: repo });

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor/mcp.json"), "utf-8"));
    expect(cursor.mcpServers.agentmemory.command).toBe("npx");
    expect(fs.existsSync(path.join(repo, "mcp", "shared", "agentmemory.json"))).toBe(false);
  });
});
