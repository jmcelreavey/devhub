import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

describe("repo_ship", () => {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  let registerShipTools: (typeof import("./ship.ts"))["registerShipTools"];
  let prevRepoRoot: string | undefined;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    handlers.clear();
    childProcess.spawn.mockReset();
    childProcess.execFile.mockReset();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-test-"));
    vi.spyOn(os, "tmpdir").mockReturnValue(tempDir);
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
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("previews by default when confirmation is omitted", async () => {
    childProcess.execFile.mockImplementation((_file, _args, _opts, callback) => callback(null, "preview", ""));

    await handlers.get("repo_ship")!({});

    expect(childProcess.execFile).toHaveBeenCalledWith(
      process.execPath,
      [expect.any(String), "--tsconfig", path.join(REPO_ROOT, "apps/ui/tsconfig.json"), path.join(REPO_ROOT, "apps/core/src/scripts/ship.ts"), "--dry-run"],
      expect.objectContaining({ encoding: "utf-8", cwd: REPO_ROOT }),
      expect.any(Function),
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("starts a mutating run only with explicit confirmation", async () => {
    childProcess.execFile.mockImplementation((_file, _args, _opts, callback) => callback(Object.assign(new Error("not running"), { code: 1 }), "", ""));
    childProcess.spawn.mockReturnValue({ pid: 123, unref: vi.fn() } as unknown as ChildProcess);

    await handlers.get("repo_ship")!({ confirm: true });

    expect(childProcess.spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.any(String), "--tsconfig", path.join(REPO_ROOT, "apps/ui/tsconfig.json"), path.join(REPO_ROOT, "apps/core/src/scripts/ship.ts")],
      expect.objectContaining({ detached: true, cwd: REPO_ROOT }),
    );
  });
});
