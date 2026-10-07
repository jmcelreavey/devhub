import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    realpathSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));
vi.mock("@/lib/agent-runs/providers", () => ({ resolveBinary: vi.fn() }));
vi.mock("@/lib/exec-external", () => ({ execExternal: vi.fn() }));
vi.mock("@/lib/scheduler-log", () => ({ appendSchedulerLog: vi.fn() }));
vi.mock("./update", () => ({ hasActivePaseoWork: vi.fn() }));

import { resolveBinary } from "@/lib/agent-runs/providers";
import { execExternal } from "@/lib/exec-external";
import { hasActivePaseoWork } from "./update";
import { agentUpdateCommands, updateAgentClis } from "./agent-cli-updates";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); });
  vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));
  vi.mocked(resolveBinary).mockImplementation((names) => {
    const found: Record<string, string> = {
      claude: "/home/test/.local/bin/claude",
      "cursor-agent": "/home/test/.local/bin/cursor-agent",
      opencode: "/home/test/.opencode/bin/opencode",
      copilot: "/opt/homebrew/bin/copilot",
      codex: "/Applications/ChatGPT.app/Contents/Resources/codex",
    };
    return found[names[0]] ?? null;
  });
});

describe("agent CLI updates", () => {
  it("uses native updaters and Safe-Chain for npm, leaving app-managed Codex alone", () => {
    vi.mocked(fs.realpathSync).mockImplementation((p) => {
      const targets: Record<string, string> = {
        "/home/test/.local/bin/claude": "/home/test/.local/share/claude/versions/2.1.0",
        "/home/test/.local/bin/cursor-agent": "/home/test/.local/share/cursor-agent/versions/1/cursor-agent",
        "/opt/homebrew/bin/copilot": "/opt/homebrew/lib/node_modules/@github/copilot/npm-loader.js",
      };
      return targets[String(p)] ?? String(p);
    });
    expect(agentUpdateCommands()).toEqual([
      { label: "Claude", bin: "/home/test/.local/bin/claude", args: ["update"] },
      { label: "Cursor", bin: "/home/test/.local/bin/cursor-agent", args: ["update"] },
      { label: "OpenCode", bin: "/home/test/.opencode/bin/opencode", args: ["upgrade"] },
      { label: "Copilot", bin: "aikido-npm", args: ["install", "-g", "@github/copilot"] },
    ]);
  });

  it("defers all updates while Paseo has an active chat", async () => {
    vi.mocked(hasActivePaseoWork).mockResolvedValue(true);
    await updateAgentClis();
    expect(execExternal).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("updates an installed CLI and records a completed daily pass", async () => {
    vi.mocked(hasActivePaseoWork).mockResolvedValue(false);
    vi.mocked(resolveBinary).mockImplementation((names) => names[0] === "opencode" ? "/home/test/.opencode/bin/opencode" : null);
    await updateAgentClis(1_000_000_000_000);
    expect(execExternal).toHaveBeenCalledWith("/home/test/.opencode/bin/opencode", ["upgrade"], expect.objectContaining({ timeoutMs: 300_000 }));
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("agent-cli-updates.json"), JSON.stringify({ lastAttemptAt: 1_000_000_000_000 }), { mode: 0o600 });
  });
});
