import { describe, expect, it } from "vitest";
import {
  applyCursorAcpServerOverlay,
  CURSOR_ACP_DEVHUB_TOOLSETS,
  orderCursorMcpServers,
} from "./cursor-acp-surface";

describe("applyCursorAcpServerOverlay", () => {
  it("pins DevHub toolsets and lean-ctx's standard profile", () => {
    expect(
      applyCursorAcpServerOverlay("devhub", {
        command: "tsx",
        env: { NOTES_DIR: "/notes" },
      }),
    ).toEqual({
      command: "tsx",
      env: {
        NOTES_DIR: "/notes",
        DEVHUB_MCP_TOOLSETS: CURSOR_ACP_DEVHUB_TOOLSETS,
      },
    });
    expect(
      applyCursorAcpServerOverlay("lean-ctx", { command: "/opt/lean-ctx" }),
    ).toEqual({
      command: "/opt/lean-ctx",
      env: { LEAN_CTX_TOOL_PROFILE: "standard" },
    });
    expect(
      applyCursorAcpServerOverlay("playwriter", { command: "npx" }),
    ).toEqual({
      command: "npx",
    });
  });
});

describe("orderCursorMcpServers", () => {
  it("puts Playwriter and lean-ctx ahead of DevHub", () => {
    const ordered = orderCursorMcpServers({
      devhub: { command: "devhub" },
      agentmemory: { command: "mem" },
      playwriter: { command: "pw" },
      "lean-ctx": { command: "lc" },
    });
    expect(Object.keys(ordered)).toEqual([
      "playwriter",
      "lean-ctx",
      "agentmemory",
      "devhub",
    ]);
  });
});
