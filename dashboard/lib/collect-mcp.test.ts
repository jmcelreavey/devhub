import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanLocalMcpImportCandidates, collectMcpServers } from "./collect-mcp";

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

describe("collect-mcp", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  function makeTempRepo(): { repo: string; home: string; lines: string[] } {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collectmcp-repo-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collectmcp-home-"));
    process.env.HOME = home;
    fs.mkdirSync(path.join(repo, "mcp", "shared"), { recursive: true });
    return { repo, home, lines: [] };
  }

  it("surfaces agentmemory from ~/.cursor/mcp.json", () => {
    const { repo, home } = makeTempRepo();
    writeJson(path.join(home, ".cursor/mcp.json"), {
      mcpServers: {
        agentmemory: {
          command: "npx",
          args: ["-y", "@agentmemory/mcp"],
          env: { AGENTMEMORY_URL: "http://localhost:3111" },
        },
      },
    });

    const cands = scanLocalMcpImportCandidates(repo);
    const entry = cands.find((c) => c.name === "agentmemory");
    expect(entry).toBeDefined();
    expect(entry!.alreadyInRepo).toBe(false);
    expect(entry!.unsupported).toBe(false);
    expect(entry!.sources.find((s) => s.tool === "cursor")?.configPath).toContain(".cursor/mcp.json");
  });

  it("surfaces stdio and remote servers", () => {
    const { repo, home } = makeTempRepo();
    writeJson(path.join(home, ".config/cursor/mcp.json"), {
      mcpServers: {
        local1: { command: "/bin/local", args: ["-x"] },
      },
    });
    writeJson(path.join(home, ".config/opencode/opencode.json"), {
      mcp: {
        local1: { type: "local", command: ["/bin/local", "-x"], enabled: true },
        atlassian: { type: "remote", url: "https://x.example/mcp", enabled: true },
      },
    });

    const cands = scanLocalMcpImportCandidates(repo);
    const local1 = cands.find((c) => c.name === "local1");
    const atlassian = cands.find((c) => c.name === "atlassian");
    expect(local1).toBeDefined();
    expect(local1!.alreadyInRepo).toBe(false);
    expect(local1!.unsupported).toBe(false);
    expect(local1!.sources.find((s) => s.tool === "cursor")?.canonical?.command).toBe("/bin/local");

    expect(atlassian).toBeDefined();
    expect(atlassian!.unsupported).toBe(false);
    expect(atlassian!.sources.every((s) => s.remote)).toBe(true);
    expect(atlassian!.sources.find((s) => s.tool === "opencode")?.canonical?.url).toBe("https://x.example/mcp");
  });

  it("reverse-substitutes REPO_ROOT for paths under the repo", () => {
    const { repo, home } = makeTempRepo();
    writeJson(path.join(home, ".claude.json"), {
      mcpServers: {
        notes: {
          command: `${repo}/bin/notes`,
          args: [`${repo}/src/index.ts`],
          env: { CFG: `${repo}/cfg.json` },
        },
      },
    });

    const cands = scanLocalMcpImportCandidates(repo);
    const notes = cands.find((c) => c.name === "notes")!;
    const canonical = notes.sources.find((s) => s.tool === "claude")!.canonical!;
    expect(canonical.command).toBe("REPO_ROOT/bin/notes");
    expect(canonical.args).toEqual(["REPO_ROOT/src/index.ts"]);
    expect(canonical.env).toEqual({ CFG: "REPO_ROOT/cfg.json" });
  });

  it("collectMcpServers writes mcp/shared/<name>.json from selected names", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(home, ".claude.json"), {
      mcpServers: {
        foo: { command: "/bin/foo", args: ["--a"] },
        remote1: { type: "remote", url: "https://x.example" },
      },
    });

    const code = await collectMcpServers({
      emit: (l) => lines.push(l),
      repoRoot: repo,
      importServerNames: ["foo", "remote1"],
    });
    expect(code).toBe(0);

    const fooFile = path.join(repo, "mcp", "shared", "foo.json");
    expect(fs.existsSync(fooFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(fooFile, "utf-8"));
    expect(parsed.command).toBe("/bin/foo");
    expect(parsed.args).toEqual(["--a"]);

    const remoteFile = path.join(repo, "mcp", "shared", "remote1.json");
    expect(fs.existsSync(remoteFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(remoteFile, "utf-8")).url).toBe("https://x.example");
  });

  it("skips servers already in repo", async () => {
    const { repo, home, lines } = makeTempRepo();
    writeJson(path.join(home, ".claude.json"), {
      mcpServers: { foo: { command: "/bin/foo" } },
    });
    writeJson(path.join(repo, "mcp", "shared", "foo.json"), { command: "REPO_ROOT/existing" });

    await collectMcpServers({ emit: (l) => lines.push(l), repoRoot: repo });
    const parsed = JSON.parse(fs.readFileSync(path.join(repo, "mcp", "shared", "foo.json"), "utf-8"));
    // Untouched
    expect(parsed.command).toBe("REPO_ROOT/existing");
  });
});
