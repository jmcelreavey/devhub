import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  reverseSubstituteRepoRoot,
  substituteRepoRoot,
  syncMcpServers,
  type Json,
} from "./sync-mcp";

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

describe("substituteRepoRoot / reverseSubstituteRepoRoot", () => {
  it("round-trips REPO_ROOT through nested objects", () => {
    const repo = "/home/me/repo";
    const input: Json = {
      command: "REPO_ROOT/bin/x",
      args: ["REPO_ROOT/src/index.ts", "--flag"],
      env: { CFG: "REPO_ROOT/cfg.json" },
    };
    const substituted = substituteRepoRoot(input, repo) as Record<string, Json>;
    expect(substituted.command).toBe("/home/me/repo/bin/x");
    const reversed = reverseSubstituteRepoRoot(substituted, repo);
    expect(reversed).toEqual(input);
  });

  it("does not touch unrelated absolute paths", () => {
    const repo = "/home/me/repo";
    const out = reverseSubstituteRepoRoot("/usr/local/bin/tsx", repo);
    expect(out).toBe("/usr/local/bin/tsx");
  });
});

describe("syncMcpServers", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  function makeTempRepo(): { repo: string; home: string; lines: string[] } {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-repo-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-home-"));
    process.env.HOME = home;
    fs.mkdirSync(path.join(repo, "mcp", "shared"), { recursive: true });
    return { repo, home, lines: [] };
  }

  it("writes stdio entries to claude/codex/cursor and OpenCode-shape entries to opencode", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(repo, "mcp", "shared", "notes.json"), {
      command: "REPO_ROOT/bin/notes",
      args: ["--port", "9"],
      env: { NOTES_DIR: "REPO_ROOT/notes" },
    });

    const code = await syncMcpServers({
      emit: (l) => lines.push(l),
      repoRoot: repo,
      prune: true,
    });

    expect(code).toBe(0);

    const claude = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf-8"));
    expect(claude.mcpServers.notes.command).toBe(`${repo}/bin/notes`);
    expect(claude.mcpServers.notes.args).toEqual(["--port", "9"]);
    expect(claude.mcpServers.notes.env).toEqual({ NOTES_DIR: `${repo}/notes` });

    const codex = JSON.parse(fs.readFileSync(path.join(home, ".codex/mcp.json"), "utf-8"));
    expect(codex.mcpServers.notes.command).toBe(`${repo}/bin/notes`);

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor/mcp.json"), "utf-8"));
    expect(cursor.mcpServers.notes.command).toBe(`${repo}/bin/notes`);

    const opencode = JSON.parse(
      fs.readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf-8"),
    );
    expect(opencode.mcp.notes.type).toBe("local");
    expect(opencode.mcp.notes.enabled).toBe(true);
    expect(opencode.mcp.notes.command).toEqual([`${repo}/bin/notes`, "--port", "9"]);
    expect(opencode.mcp.notes.env).toEqual({ NOTES_DIR: `${repo}/notes` });
  });

  it("preserves other top-level keys when mergeRest is on (claude/opencode)", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(repo, "mcp", "shared", "notes.json"), { command: "REPO_ROOT/x" });
    writeJson(path.join(home, ".claude.json"), { mcpServers: {}, otherStuff: { keep: true } });
    writeJson(path.join(home, ".config/opencode/opencode.json"), {
      mcp: {},
      provider: { foo: "bar" },
    });

    await syncMcpServers({ emit: (l) => lines.push(l), repoRoot: repo });

    const claude = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf-8"));
    expect(claude.otherStuff).toEqual({ keep: true });

    const opencode = JSON.parse(
      fs.readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf-8"),
    );
    expect(opencode.provider).toEqual({ foo: "bar" });
  });

  it("prune removes recognized entries missing from repo, including remote HTTP entries", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(repo, "mcp", "shared", "notes.json"), { command: "REPO_ROOT/n" });
    // Cursor legacy path: existing stale stdio + a stale remote entry
    writeJson(path.join(home, ".config/cursor/mcp.json"), {
      mcpServers: {
        stale: { command: "/old/bin", args: [] },
        remoteStale: { type: "remote", url: "https://stale.example/mcp" },
        notes: { command: "/old/bin", args: [] },
      },
    });
    // OpenCode: existing remote entry + stdio stale
    writeJson(path.join(home, ".config/opencode/opencode.json"), {
      mcp: {
        atlassian: { type: "remote", url: "https://x.example/mcp", enabled: true },
        stale: { type: "local", command: ["/old/bin"], enabled: true },
      },
    });

    await syncMcpServers({ emit: (l) => lines.push(l), repoRoot: repo, prune: true });

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor/mcp.json"), "utf-8"));
    expect(cursor.mcpServers.notes.command).toBe(`${repo}/n`);
    expect(cursor.mcpServers.stale).toBeUndefined();
    expect(cursor.mcpServers.remoteStale).toBeUndefined();
    const cursorLegacy = JSON.parse(
      fs.readFileSync(path.join(home, ".config/cursor/mcp.json"), "utf-8"),
    );
    expect(cursorLegacy.mcpServers).toBeUndefined();

    const opencode = JSON.parse(
      fs.readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf-8"),
    );
    expect(opencode.mcp.atlassian).toBeUndefined();
    expect(opencode.mcp.stale).toBeUndefined();
    expect(opencode.mcp.notes.type).toBe("local");
  });

  it("syncs remote shared entries to every tool shape", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(repo, "mcp", "shared", "context7.json"), {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
    });

    await syncMcpServers({ emit: (l) => lines.push(l), repoRoot: repo, prune: true });

    const claude = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf-8"));
    expect(claude.mcpServers.context7).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
    });

    const opencode = JSON.parse(
      fs.readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf-8"),
    );
    expect(opencode.mcp.context7).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
    });
  });

  it("excludeServers skips writing and also prevents pruning that entry", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(repo, "mcp", "shared", "keep.json"), { command: "REPO_ROOT/keep" });
    writeJson(path.join(repo, "mcp", "shared", "skip.json"), { command: "REPO_ROOT/skip" });
    writeJson(path.join(home, ".cursor/mcp.json"), {
      mcpServers: {
        skip: { command: "/preexisting", args: [] },
      },
    });

    await syncMcpServers({
      emit: (l) => lines.push(l),
      repoRoot: repo,
      prune: true,
      excludeServers: ["skip"],
    });

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor/mcp.json"), "utf-8"));
    expect(cursor.mcpServers.keep.command).toBe(`${repo}/keep`);
    // skip is excluded — not overwritten, not pruned
    expect(cursor.mcpServers.skip.command).toBe("/preexisting");
  });

  it("merges ~/.cursor and legacy ~/.config/cursor MCP entries on sync", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(repo, "mcp", "shared", "notes.json"), { command: "REPO_ROOT/notes" });
    writeJson(path.join(home, ".cursor/mcp.json"), {
      mcpServers: {
        agentmemory: { command: "npx", args: ["-y", "@agentmemory/mcp"] },
      },
    });
    writeJson(path.join(home, ".config/cursor/mcp.json"), {
      mcpServers: {
        notes: { command: "/legacy/notes", args: [] },
      },
    });

    await syncMcpServers({ emit: (l) => lines.push(l), repoRoot: repo });

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor/mcp.json"), "utf-8"));
    expect(cursor.mcpServers.notes.command).toBe(`${repo}/notes`);
    expect(cursor.mcpServers.agentmemory.command).toBe("npx");
    const legacy = JSON.parse(fs.readFileSync(path.join(home, ".config/cursor/mcp.json"), "utf-8"));
    expect(legacy.mcpServers).toBeUndefined();
    expect(lines.some((l) => l.includes("MIGRATED"))).toBe(true);
  });
});
