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
