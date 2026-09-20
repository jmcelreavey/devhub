import { describe, expect, it } from "vitest";
import {
  mapCursorCliModelToAion,
  modelAllowedForAssistant,
  resolveAionDispatchDefaults,
  resolveCursorAionModel,
  resolveYoloPermission,
  backendNeedsPermissionAutoconfirm,
} from "./dispatch-defaults";
import type { AionAssistant } from "./contracts";
import { conversationPayload } from "./contracts";

const cursor: AionAssistant = {
  id: "bare:a0dfb1ec",
  name: "Cursor",
  enabled: true,
  agent_id: "a0dfb1ec",
  models: [],
  agent_status: "online",
  agent: { type: "acp", source: "builtin", acp_backend: "cursor" },
};

const claude: AionAssistant = {
  ...cursor,
  id: "bare:2d23ff1c",
  name: "Claude Code",
  agent_id: "2d23ff1c",
  agent: { type: "acp", source: "builtin", acp_backend: "claude" },
};

describe("dispatch-defaults", () => {
  it("maps CLI grok ids to Aion Cursor model ids", () => {
    expect(mapCursorCliModelToAion("cursor-grok-4.6-high-fast")).toBe("grok-4.6[effort=high,fast=true]");
    expect(resolveCursorAionModel({ DEVHUB_AGENT_CURSOR_MODEL: "cursor-grok-4.6-high" })).toBe(
      "grok-4.6[effort=high]",
    );
  });

  it("uses Cursor yolo_id (not session-mode agent) and still flags autoconfirm", () => {
    const resolved = resolveAionDispatchDefaults({
      assistants: [{ ...cursor, yolo_id: "yolo" }],
      env: { DEVHUB_AGENT_CLI: "cursor", DEVHUB_AGENT_CURSOR_MODEL: "cursor-grok-4.6-high" },
    });
    expect(resolved.provider).toBe("bare:a0dfb1ec");
    expect(resolved.model).toBe("grok-4.6[effort=high]");
    expect(resolved.permission).toBe("yolo");
    expect(resolved.autoconfirmPermissions).toBe(true);
    expect(backendNeedsPermissionAutoconfirm("cursor")).toBe(true);
  });

  it("falls back to Cursor yolo when the assistants list omits yolo_id", () => {
    const resolved = resolveAionDispatchDefaults({
      assistants: [cursor],
      env: { DEVHUB_AGENT_CLI: "cursor" },
    });
    expect(resolved.permission).toBe("yolo");
    expect(resolved.autoconfirmPermissions).toBe(true);
  });

  it("uses Claude bypassPermissions for YOLO", () => {
    expect(resolveYoloPermission("claude")).toBe("bypassPermissions");
    const resolved = resolveAionDispatchDefaults({ provider: "claude", assistants: [claude] });
    expect(resolved.permission).toBe("bypassPermissions");
    expect(resolved.autoconfirmPermissions).toBe(false);
  });

  it("allows model overrides when the assistant advertises no models", () => {
    expect(modelAllowedForAssistant(cursor, "grok-4.6[effort=high]")).toBe(true);
  });

  it("sends permission, MCP ids, and autoconfirm on conversation create", () => {
    const payload = conversationPayload({
      assistantId: "bare:a0dfb1ec",
      title: "Review PR #1",
      cwd: "/tmp",
      runId: "run-1",
      model: "grok-4.6[effort=high]",
      permission: "yolo",
      autoconfirmPermissions: true,
      mcpIds: ["mcp_devhub"],
    });
    expect(payload.assistant.conversation_overrides).toEqual({
      permission: "yolo",
      model: "grok-4.6[effort=high]",
      mcp_ids: ["mcp_devhub"],
    });
    expect(payload.extra).toMatchObject({
      selected_mcp_server_ids: ["mcp_devhub"],
      devhub: { run_id: "run-1", autoconfirm_permissions: true },
    });
  });
});
