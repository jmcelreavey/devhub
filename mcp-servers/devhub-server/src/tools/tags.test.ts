import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { registerTagsTools } from "./tags.ts";

/** Mock server capturing handlers; mock dashboard recording calls. */
function setup() {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => handlers.set(name, handler),
  } as unknown as McpServer;
  const get = vi.fn();
  const post = vi.fn();
  registerTagsTools(server, { dashboard: { get, post } } as unknown as Context);
  return { handlers, get, post };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe("tags MCP tools", () => {
  it("maps tags_list to /api/tags with the substring filter", async () => {
    ctx.get.mockResolvedValue({ tags: [{ id: "auth", count: 3 }, { id: "sso", count: 1 }] });
    const result = (await ctx.handlers.get("tags_list")?.({ q: "auth" })) as {
      content: Array<{ text: string }>;
    };
    expect(ctx.get).toHaveBeenCalledWith("/api/tags", { q: "auth" });
    expect(result.content[0].text).toContain("#auth (3)");
  });

  it("says so when there are no tags yet", async () => {
    ctx.get.mockResolvedValue({ tags: [] });
    const result = (await ctx.handlers.get("tags_list")?.({})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain("No tags yet");
  });

  it("renders all lookup sections and the empty case", async () => {
    ctx.get.mockResolvedValue({
      tag: "devhub",
      tasks: [{ date: "2026-08-22", id: "t1", text: "ship #devhub", done: false }],
      notes: [{ title: "Caching", href: "/notes/learnings/devhub/caching" }],
      related: [{ kind: "jira", id: "PTF-3774", label: "PTF-3774" }],
    });
    const result = (await ctx.handlers.get("tags_lookup")?.({ tag: "devhub" })) as {
      content: Array<{ text: string }>;
    };
    expect(ctx.get).toHaveBeenCalledWith("/api/tags/devhub");
    const text = result.content[0].text;
    expect(text).toContain("[ ] 2026-08-22 ship #devhub");
    expect(text).toContain("Caching — /notes/learnings/devhub/caching");
    expect(text).toContain("[jira] PTF-3774");

    ctx.get.mockResolvedValue({ tag: "ghost", tasks: [], notes: [], related: [] });
    const empty = (await ctx.handlers.get("tags_lookup")?.({ tag: "ghost" })) as {
      content: Array<{ text: string }>;
    };
    expect(empty.content[0].text).toContain("Nothing tagged #ghost");
  });

  it("gates rename behind confirm and posts when confirmed", async () => {
    const gated = (await ctx.handlers.get("tags_rename")?.({
      from: "autj",
      to: "auth",
    })) as { content: Array<{ text: string }> };
    expect(ctx.post).not.toHaveBeenCalled();
    expect(gated.content[0].text).toContain("confirm:true");

    ctx.post.mockResolvedValue({ from: "autj", to: "auth", filesChanged: 4, replacements: 9 });
    const done = (await ctx.handlers.get("tags_rename")?.({
      from: "autj",
      to: "auth",
      confirm: true,
    })) as { content: Array<{ text: string }> };
    expect(ctx.post).toHaveBeenCalledWith("/api/tags/rename", { from: "autj", to: "auth" });
    expect(done.content[0].text).toContain("9 occurrence(s) across 4 file(s)");
  });
});
