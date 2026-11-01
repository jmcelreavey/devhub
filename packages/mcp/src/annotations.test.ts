import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { instrumentToolAnnotations, TOOL_ANNOTATIONS } from "./annotations.ts";
import { createContext } from "./context.ts";
import { createDevhubMcpServer } from "./server.ts";

/** Stub server that captures what a registrar would pass to registerTool. */
function stubServer() {
  const registered: Array<{ name: string; annotations: unknown }> = [];
  const server = {
    registerTool(name: string, config: { description?: string; annotations?: unknown }, _cb: unknown) {
      registered.push({ name, annotations: config.annotations });
    },
  };
  return { server, registered };
}

describe("instrumentToolAnnotations", () => {
  it("injects the map's annotations for a tool that sets none", () => {
    const { server, registered } = stubServer();
    instrumentToolAnnotations(server as never);
    server.registerTool("notes_delete", { description: "x" }, () => {});
    expect(registered[0].annotations).toEqual(TOOL_ANNOTATIONS.notes_delete);
  });

  it("leaves explicit per-tool annotations alone", () => {
    const { server, registered } = stubServer();
    instrumentToolAnnotations(server as never);
    const custom = { readOnlyHint: true, destructiveHint: false };
    server.registerTool("notes_delete", { description: "x", annotations: custom }, () => {});
    expect(registered[0].annotations).toBe(custom);
  });

  it("leaves unknown tools unannotated rather than guessing", () => {
    const { server, registered } = stubServer();
    instrumentToolAnnotations(server as never);
    server.registerTool("brand_new_tool", { description: "x" }, () => {});
    expect(registered[0].annotations).toBeUndefined();
  });
});

describe("TOOL_ANNOTATIONS coverage", () => {
  it("publishes annotations for registered tools", async () => {
    const { server } = createDevhubMcpServer(createContext(), { DEVHUB_MCP_TOOLSETS: "all", DEVHUB_MCP_HISTORY: "0" });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "annotation-test", version: "1" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.length).toBeGreaterThan(0);
      const missing = tools.filter((tool) => !tool.annotations).map((tool) => tool.name);
      expect(missing).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("classifies representative tools from behaviour", () => {
    expect(TOOL_ANNOTATIONS.notes_read).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(TOOL_ANNOTATIONS.notes_delete).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(TOOL_ANNOTATIONS.repos_git_push).toMatchObject({ destructiveHint: true, openWorldHint: true });
    expect(TOOL_ANNOTATIONS.agent_dispatch).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(TOOL_ANNOTATIONS.agent_wait).toMatchObject({ readOnlyHint: true });
    expect(TOOL_ANNOTATIONS.db_query).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(TOOL_ANNOTATIONS.db_execute).toMatchObject({ destructiveHint: true, openWorldHint: true });
    expect(TOOL_ANNOTATIONS.tasks_create).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(TOOL_ANNOTATIONS.tasks_update).toMatchObject({ idempotentHint: true });
    expect(TOOL_ANNOTATIONS.share_revoke).toMatchObject({ destructiveHint: true });
    expect(TOOL_ANNOTATIONS.recall_remember).toMatchObject({ idempotentHint: false });
    expect(TOOL_ANNOTATIONS.recall_index).toMatchObject({ idempotentHint: true });
  });

  it("never marks a destructive tool read-only", () => {
    for (const [name, hints] of Object.entries(TOOL_ANNOTATIONS)) {
      if (hints.destructiveHint) expect(hints.readOnlyHint, name).toBe(false);
    }
  });
});
