import type { ChildProcess } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import { registerShipTools } from "./ship.ts";

describe("repo_ship", () => {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  beforeEach(() => {
    handlers.clear();
    childProcess.spawn.mockReset();
    childProcess.spawnSync.mockReset();
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => handlers.set(name, handler),
    } as unknown as McpServer;
    registerShipTools(server, {} as Context);
  });

  it("previews by default when confirmation is omitted", async () => {
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "preview", stderr: "" });

    await handlers.get("repo_ship")?.({});

    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      "bash",
      [expect.stringMatching(/scripts\/devhub-ship\.sh$/), "--dry-run"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("starts a mutating run only with explicit confirmation", async () => {
    childProcess.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });
    childProcess.spawn.mockReturnValue({ pid: 123, unref: vi.fn() } as unknown as ChildProcess);

    await handlers.get("repo_ship")?.({ confirm: true });

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "bash",
      [expect.stringMatching(/scripts\/devhub-ship\.sh$/)],
      expect.objectContaining({ detached: true }),
    );
  });
});
