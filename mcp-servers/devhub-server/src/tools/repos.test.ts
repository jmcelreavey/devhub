import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { registerReposTools } from "./repos.ts";

describe("repos_git_show", () => {
  it("maps the tool ref argument to the dashboard commit parameter", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ hash: "abc123" });
    const context = { dashboard: { get } } as unknown as Context;
    registerReposTools(server, context);

    await handlers.get("repos_git_show")?.({ name: "demo", ref: "HEAD~1", path: "README.md" });

    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/show", {
      commit: "HEAD~1",
      path: "README.md",
    });
  });
});
