import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { registerNotesTools } from "./notes.ts";

function registeredNotesTools(context: Context) {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => handlers.set(name, handler),
  } as unknown as McpServer;
  registerNotesTools(server, context);
  return handlers;
}

describe("notes_devhub_open", () => {
  it("opens an existing note in a new desktop workspace tab", async () => {
    const post = vi.fn().mockResolvedValue({ delivered: 1 });
    const storage = {
      read: vi.fn().mockReturnValue({ path: "discovery/example.json", content: [] }),
    };
    const handlers = registeredNotesTools({ storage, dashboard: { post } } as unknown as Context);

    const result = await handlers.get("notes_devhub_open")?.({ path: "discovery/example" });

    expect(post).toHaveBeenCalledWith("/api/desktop/navigation", {
      href: "/notes/discovery/example",
      newTab: true,
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Opened discovery/example in a new DevHub workspace tab." }],
    });
  });

  it("does not navigate when the note does not exist", async () => {
    const post = vi.fn();
    const handlers = registeredNotesTools({
      storage: { read: vi.fn().mockReturnValue(null) },
      dashboard: { post },
    } as unknown as Context);

    const result = await handlers.get("notes_devhub_open")?.({ path: "missing" });

    expect(post).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
  });
});

it("keeps Cursor note tools routed through the selected repository", async () => {
  const post = vi.fn().mockResolvedValue({ writable: true, path: "/fixture/repo" });
  const patch = vi.fn().mockResolvedValue({ ok: true });
  const remove = vi.fn().mockResolvedValue({ ok: true });
  const handlers = registeredNotesTools({ storage: {}, dashboard: { post, patch, delete: remove } } as unknown as Context);
  expect(await handlers.get("notes_cursor_open")?.({ path: "daily/example", repoName: "repo", worktree: "branch" })).toMatchObject({
    content: [{ text: "Opened daily/example in Cursor beside /fixture/repo. Edit the Markdown copy, then use notes_cursor_apply." }],
  });
  expect(post).toHaveBeenCalledWith("/api/repos/repo/open", { notePath: "daily/example", worktree: "branch" });
  await handlers.get("notes_cursor_apply")?.({ path: "daily/example", repoName: "repo" });
  await handlers.get("notes_cursor_delete")?.({ path: "daily/example", repoName: "repo" });
  expect(patch).toHaveBeenCalledWith("/api/repos/repo/open", { notePath: "daily/example" });
  expect(remove).toHaveBeenCalledWith("/api/repos/repo/open", { notePath: "daily/example" });
});
