import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { owningDomainForPath, registerOwnershipTools } from "./ownership.ts";

describe("owningDomainForPath", () => {
  it("ranks by the matching prefix, not an unmatched longer path on the same domain", () => {
    expect(
      owningDomainForPath(
        [
          { id: "src", paths: ["src/unrelated/very/long/path/that/does/not/match", "src"] },
          { id: "foo", paths: ["src/foo"] },
        ],
        "src/foo/bar.ts",
      )?.id,
    ).toBe("foo");
  });
});

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

  it("ranks repo_who_owns by the matching prefix, not the longest path on the domain", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler),
    } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({
      repo: { fullName: "acme/widgets" },
      domains: [
        {
          id: "src",
          label: "src",
          paths: ["src/unrelated/very/long/path/that/does/not/match", "src"],
          codeowners: ["@core"],
        },
        { id: "foo", label: "foo", paths: ["src/foo"], codeowners: ["@foo"] },
      ],
      teams: [
        { label: "Foo", domains: ["foo"] },
        { label: "Core", domains: ["src"] },
      ],
      prs: [],
      gaps: [],
      digest: null,
    });
    const post = vi.fn().mockResolvedValue({ reviewers: [] });
    registerOwnershipTools(server, { dashboard: { get, post } } as unknown as Context);

    const result = await handlers.get("repo_who_owns")?.({ repo: "acme/widgets", path: "src/foo/bar.ts" }) as {
      content: Array<{ text: string }>;
    };
    const body = JSON.parse(result.content[0]!.text) as { domain: { id: string }; team: { label: string } };
    expect(body.domain.id).toBe("foo");
    expect(body.team.label).toBe("Foo");
  });
});
