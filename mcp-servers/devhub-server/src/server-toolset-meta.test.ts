import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createContext } from "./context.ts";
import { createDevhubMcpServer } from "./server.ts";

async function listTools(toolsets: string) {
  const { server } = createDevhubMcpServer(createContext(), { DEVHUB_MCP_TOOLSETS: toolsets, DEVHUB_MCP_HISTORY: "0" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try { return (await client.listTools()).tools; } finally { await client.close(); }
}

describe("toolset tag on listed tools", () => {
  it("adds the registering toolset as additive _meta and keeps annotations", async () => {
    const tools = await listTools("status,integrations");
    expect(tools.length).toBeGreaterThan(5);
    const tagged = new Set(tools.map((tool) => (tool._meta as Record<string, unknown> | undefined)?.["devhub/toolset"]));
    expect(tagged).toEqual(new Set(["status", "integrations"]));
    expect(tools.find((tool) => tool.name === "integrations_slack_usage")).toMatchObject({ annotations: { readOnlyHint: true }, _meta: { "devhub/toolset": "integrations" } });
  });
  it("groups the tasks toolset's several registrars under one name", async () => {
    const tools = await listTools("tasks");
    expect(tools.find((tool) => tool.name === "task_note_add")).toMatchObject({ annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, _meta: { "devhub/toolset": "tasks" } });
    expect(new Set(tools.map((tool) => (tool._meta as Record<string, unknown>)["devhub/toolset"]))).toEqual(new Set(["tasks"]));
  });
});
