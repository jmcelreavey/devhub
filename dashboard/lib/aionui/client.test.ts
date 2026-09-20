import { describe, expect, it, vi } from "vitest";
import { AionClient } from "./client";
import { aionConnectionId, aionConversationUrl, localAionOrigin, type AionConnection } from "./connection";
import { activeRuntimeState, type AionRuntime } from "./contracts";

const connection: AionConnection = { origin: "http://127.0.0.1:25808", userId: "user", anchorConversationId: "anchor" };
const idle: AionRuntime = {
  state: "idle", can_send_message: true, has_task: false, task_status: null,
  is_processing: false, pending_confirmations: 0, turn_id: null, supports_midturn_delivery: false,
};
const conversation = (id = "chat", runtime = idle) => ({
  id, name: "Review", type: "codex", status: "pending", runtime, created_at: 1, modified_at: 2, extra: {},
});
const assistant = { id: "assistant-codex", name: "Codex", enabled: true, agent_id: "codex", models: ["model-from-catalog"], agent_status: "online" };
const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status });

function harness(overrides: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined = () => undefined) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const override = overrides(String(url), init);
    if (override) return override;
    if (String(url).endsWith("/api/system/current-user")) return ok({ id: "user", username: "name" });
    if (String(url).endsWith("/api/conversations/anchor")) return ok(conversation("anchor"));
    if (String(url).endsWith("/api/assistants")) return ok([assistant]);
    if (String(url).endsWith("/api/conversations/chat")) return ok(conversation());
    throw new Error("Unexpected request");
  });
  return { fetcher, client: new AionClient(connection, { fetch: fetcher }) };
}

describe("AionUi release contract", () => {
  it("creates through the selected native assistant with YOLO permission and optional model override", async () => {
    const { client, fetcher } = harness((url, init) => url.endsWith("/api/conversations") && init?.method === "POST" ? ok(conversation(), 201) : undefined);
    await client.createConversation({ assistantId: assistant.id, cwd: "/project", runId: "run-id", title: "Review", model: "model-from-catalog" });
    const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      name: "Review", assistant: { id: assistant.id, conversation_overrides: { permission: "yolo", model: "model-from-catalog" } },
      extra: { workspace: "/project", custom_workspace: true, devhub: { run_id: "run-id" } },
    });
    expect(call?.[1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });

  it("refuses a different identity before creating a conversation", async () => {
    const { client, fetcher } = harness((url) => url.endsWith("/current-user") ? ok({ id: "someone-else", username: "name" }) : undefined);
    await expect(client.createConversation({ assistantId: assistant.id, cwd: "/project", runId: "run", title: "Review" })).rejects.toThrow("different user");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("refuses a different history store even when local-mode user IDs match", async () => {
    const { client, fetcher } = harness((url) => url.endsWith("/anchor") ? new Response(null, { status: 404 }) : undefined);
    await expect(client.sendMessage("chat", "Review this")).rejects.toMatchObject({ status: 404 });
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("keeps submitted message and turn IDs without claiming completion", async () => {
    const running = { ...idle, state: "running" as const, is_processing: true, turn_id: "turn" };
    const { client } = harness((url) => url.endsWith("/messages") ? ok({ msg_id: "message", turn_id: "turn", runtime: running }, 202) : undefined);
    const result = await client.sendMessage("chat", "Review this");
    expect(result).toMatchObject({ msg_id: "message", turn_id: "turn", delivered_midturn: false });
    expect(activeRuntimeState(result.runtime)).toBe("running");
    expect(activeRuntimeState(idle)).toBeNull();
    expect(activeRuntimeState({ ...idle, pending_confirmations: 1 })).toBe("needs-attention");
  });

  it("does not inject into a busy conversation", async () => {
    const { client, fetcher } = harness((url) => url.endsWith("/chat") ? ok(conversation("chat", { ...idle, is_processing: true, turn_id: "existing" })) : undefined);
    await expect(client.sendMessage("chat", "Review this")).rejects.toThrow("busy");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("does not retry a write whose acknowledgement was lost", async () => {
    const { client, fetcher } = harness((url) => url.endsWith("/messages") ? Promise.reject(new Error("socket closed; secret details")) : undefined);
    await expect(client.sendMessage("chat", "Review this")).rejects.toMatchObject({ ambiguous: true, message: expect.not.stringContaining("secret") });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("rejects an incompatible response after an accepted write as ambiguous", async () => {
    const { client } = harness((url) => url.endsWith("/messages") ? ok({ unexpected: "shape" }, 202) : undefined);
    await expect(client.sendMessage("chat", "Review this")).rejects.toMatchObject({ ambiguous: true });
  });

  it("cancels only the requested turn", async () => {
    const { client, fetcher } = harness((url) => url.endsWith("/cancel") ? ok({ runtime: { ...idle, state: "cancelling", turn_id: "turn" } }) : undefined);
    await client.cancelTurn("chat", "turn");
    const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(request?.[0]).toBe(`${connection.origin}/api/conversations/chat/cancel`);
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ turn_id: "turn" });
  });

  it("strips credential-bearing and command fields from the browser's picker data", async () => {
    const { client } = harness((url) => url.endsWith("/assistants") ? ok([{ ...assistant, env: { TOKEN: "secret" }, command: "private command", context: "private prompt" }]) : undefined);
    expect(await client.listAssistants()).toEqual([assistant]);
  });

  it("refuses model settings that are not advertised for that assistant", async () => {
    const { client } = harness();
    await expect(client.createConversation({ assistantId: assistant.id, cwd: "/project", runId: "run", title: "Review", model: "invented" })).rejects.toThrow("not advertised");
  });
});

describe("AionUi conversation archive", () => {
  it("archives through the sidebar endpoint with an empty POST", async () => {
    const { client, fetcher } = harness((url) => url.endsWith("/archive") ? ok({}, 200) : undefined);
    await client.archiveConversation("chat");
    const request = fetcher.mock.calls.find((item) => String(item[0]).includes("/archive"));
    expect(request?.[0]).toBe(`${connection.origin}/api/sidebar/conversation/chat/archive`);
    expect(request?.[1]).toMatchObject({ method: "POST" });
    expect(request?.[1]?.body).toBeUndefined();
  });
});

describe("AionUi connection targets", () => {
  it.each(["https://example.com", "http://localhost.evil.test", "http://127.0.0.1/path", "http://user:secret@127.0.0.1", "http://127.0.0.1?token=secret", "file:///tmp/aion"])("rejects unsafe origin %s", (origin) => {
    expect(() => localAionOrigin(origin)).toThrow();
  });

  it("escapes conversation IDs within the verified web route", () => {
    expect(aionConversationUrl(connection.origin, "id/?next=other")).toBe(`${connection.origin}/#/conversation/id%2F%3Fnext%3Dother`);
  });

  it("keeps connection identity stable across token refresh, but not a different history store", () => {
    expect(aionConnectionId(connection)).toBe(aionConnectionId({ ...connection, accessToken: "new-token" }));
    expect(aionConnectionId(connection)).not.toBe(aionConnectionId({ ...connection, anchorConversationId: "other-store" }));
  });
});

describe("AionUi MCP attach ids", () => {
  const servers = [
    { id: "managed", name: "devhub", description: "[DevHub managed] notes", enabled: true, builtin: false },
    { id: "lean", name: "lean-ctx", description: "wrap", enabled: true, builtin: false },
    { id: "off", name: "playwriter", description: "[DevHub managed] browser", enabled: false, builtin: false },
    { id: "stock", name: "builtin-fs", enabled: true, builtin: true },
  ];

  it("bootstrap enablement still targets only DevHub-managed servers", async () => {
    const { client } = harness((url) => url.endsWith("/api/mcp/servers") ? ok(servers) : undefined);
    await expect(client.listManagedEnabledMcpIds()).resolves.toEqual(["managed"]);
  });

  it("Implement/Plan attach every enabled non-builtin server", async () => {
    const { client } = harness((url) => url.endsWith("/api/mcp/servers") ? ok(servers) : undefined);
    await expect(client.listEnabledMcpIds()).resolves.toEqual(["managed", "lean"]);
  });
});

