import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

describe("repo_ship", () => {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  let registerShipTools: (typeof import("./ship.ts"))["registerShipTools"];
  let prevRepoRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    handlers.clear();
    childProcess.spawn.mockReset();
    childProcess.spawnSync.mockReset();
    prevRepoRoot = process.env.REPO_ROOT;
    process.env.REPO_ROOT = REPO_ROOT;
    ({ registerShipTools } = await import("./ship.ts"));
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => handlers.set(name, handler),
    } as unknown as McpServer;
    registerShipTools(server, {} as Context);
    expect(handlers.has("repo_ship")).toBe(true);
  });

  afterEach(() => {
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
  });

  it("previews by default when confirmation is omitted", async () => {
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "preview", stderr: "" });

    await handlers.get("repo_ship")!({});

    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      "bash",
      [expect.stringMatching(/scripts\/devhub-ship\.sh$/), "--dry-run"],
      expect.objectContaining({ encoding: "utf-8", cwd: REPO_ROOT }),
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("starts a mutating run only with explicit confirmation", async () => {
    childProcess.spawnSync.mockImplementation((cmd: string) => {
      if (cmd === "pgrep") return { status: 1, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    childProcess.spawn.mockReturnValue({ pid: 123, unref: vi.fn() } as unknown as ChildProcess);

    await handlers.get("repo_ship")!({ confirm: true });

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "bash",
      [expect.stringMatching(/scripts\/devhub-ship\.sh$/)],
      expect.objectContaining({ detached: true, cwd: REPO_ROOT }),
    );
  });
});
