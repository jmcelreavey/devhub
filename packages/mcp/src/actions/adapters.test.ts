import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it, vi } from "vitest";
import { z } from "../../../../packages/shared/index.ts";
import { defineAction } from "../../../../packages/shared/actions/index.ts";
import { httpAction } from "../../../../apps/core/src/lib/actions/http.ts";
import { registerAction } from "./register.ts";

it("uses one action schema for HTTP and MCP validation and errors", async () => {
  const schema = z.strictObject({ value: z.string().min(1), fail: z.boolean().default(false) });
  const action = defineAction<typeof schema, { prefix: string }, string>({
    input: schema,
    http: { method: "POST", path: "/fixture" },
    mcp: { name: "fixture_action", toolset: "fixture", description: "Fixture action" },
    handler: ({ value, fail }, context) => {
      if (fail) throw new Error("fixture failure");
      return context.prefix + value;
    },
  });
  const context = { prefix: "ok:" };
  const route = httpAction(action, {
    input: (request) => request.json(),
    context: () => context,
    response: (value) => Response.json({ value }),
  });
  const request = (body: string) => new Request("http://localhost/fixture", { method: "POST", body });
  const restricted = httpAction(action, {
    input: () => { throw new Error("must not parse denied requests"); },
    context: () => context,
    response: (value) => Response.json({ value }),
    authorize: () => Response.json({ error: "Forbidden" }, { status: 403 }),
  });
  const server = new McpServer({ name: "fixture", version: "1" });
  registerAction(server, action, context, (value) => ({ content: [{ type: "text", text: value }] }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fixture", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect((await restricted(request("{"))).status).toBe(403);
    const success = await route(request(JSON.stringify({ value: "test" })));
    expect(await success.json()).toEqual({ value: "ok:test" });
    expect((await client.listTools()).tools[0]).toMatchObject({ name: "fixture_action" });
    expect(await client.callTool({ name: "fixture_action", arguments: { value: "test" } })).toMatchObject({ content: [{ text: "ok:test" }] });
    expect((await route(request("{"))).status).toBe(400);
    for (const input of [{ value: "" }, { value: "test", unexpected: true }]) {
      expect((await route(request(JSON.stringify(input)))).status).toBe(400);
      expect(await client.callTool({ name: "fixture_action", arguments: input })).toMatchObject({ isError: true });
    }
    const failure = await route(request(JSON.stringify({ value: "test", fail: true })));
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: "fixture failure" });
    expect(await client.callTool({ name: "fixture_action", arguments: { value: "test", fail: true } })).toMatchObject({ isError: true });
  } finally {
    consoleError.mockRestore();
    await client.close();
    await server.close();
  }
});
