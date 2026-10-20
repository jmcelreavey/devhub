import path from "node:path";
import { connectPluginMcp, createPluginAwareSession, discoverPluginMcpSpecs } from "./plugin-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { createContext } from "../../../../mcp-servers/devhub-server/src/context";
import { createDevhubMcpServer } from "../../../../mcp-servers/devhub-server/src/server";
import { groupByCategory, toSlackTool } from "./mcp-catalog";
import { toolOptions, toolSubcalls } from "./tool-options";

it("retains the entire real DevHub catalog and exposes every enum sub-call", async () => {
  // Registration and tools/list only: no tool executes and no dashboard HTTP request is made.
  const { server } = createDevhubMcpServer(createContext(), { NODE_ENV: "test", DEVHUB_MCP_TOOLSETS: "all", DEVHUB_MCP_HISTORY: "0" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "slack-coverage-test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    const raw = (await client.listTools()).tools;
    const tools = raw.map(toSlackTool).filter((tool) => tool !== null);
    expect(tools.length).toBe(raw.length);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(raw.length);
    const options = toolOptions(tools);
    for (const tool of tools) {
      expect(options.some((option) => option.id === "tool:" + tool.name)).toBe(true);
      expect(options.filter((option) => option.id.startsWith("call:" + tool.name + ":"))).toHaveLength(toolSubcalls(tool).length);
    }
    if (process.env.SLACK_AUDIT_LIVE) {
      const specs = discoverPluginMcpSpecs({ repoRoot: path.resolve(process.cwd(), ".."), runtime: () => [] })
        .filter((spec) => spec.kind === "stdio" || new URL(spec.url).port !== "1337");
      const session = createPluginAwareSession({ listTools: async () => raw, callTool: async () => { throw new Error("Inventory only"); }, close: async () => {} }, {
        discover: () => specs, connect: (spec) => connectPluginMcp(spec, "work"),
      });
      try {
        const listed = (await session.listTools()).map(toSlackTool).filter((tool) => tool !== null);
        const oldNames = new Set(tools.map((tool) => tool.name));
        for (const tool of listed.filter((tool) => tool.plugin)) oldNames.add(tool.originalName ?? tool.name);
        console.info(JSON.stringify({ totalBefore: oldNames.size, totalAfter: listed.length, selectableAfter: toolOptions(listed).length,
          servers: specs.map((spec) => ({ id: spec.id, plugin: !!spec.plugin, tools: listed.filter((tool) => tool.server === spec.id).length })),
        }));
      } finally { await session.close(); }
    }
    if (process.env.SLACK_AUDIT_COUNTS) {
      const before = [...groupByCategory(tools).values()].slice(0, 252).reduce((total, group) => total + Math.min(group.length, 252), 0);
      console.info(JSON.stringify({ coreBefore: before, coreAfter: tools.length, selectableBefore: before, selectableAfter: options.length, groups: groupByCategory(tools).size }));
    }
  } finally { await client.close(); await server.close(); }
}, 30_000);
