import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { registerOwnershipTools } from "./ownership.ts";

describe("ownership MCP tools", () => {
  it("maps repo_owner_brief to the owner/name dashboard route", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler),
    } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ repo: { fullName: "acme/widgets" } });
    registerOwnershipTools(server, { dashboard: { get } } as unknown as Context);

    await handlers.get("repo_owner_brief")?.({ repo: "acme/widgets" });

    expect(get).toHaveBeenCalledWith("/api/own/acme/widgets/brief", undefined, 120_000);
  });
});
