import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultModelFor, mapCursorCliModel, resolveBackgroundCli, resolvePaseoLaunch, splitParameterizedModel } from "./launch";

describe("splitParameterizedModel", () => {
  it("splits Cursor's parameterized ids into model, thinking and fast", () => {
    expect(splitParameterizedModel("grok-4.6[effort=high]")).toEqual({ model: "grok-4.6", thinking: "high" });
    expect(splitParameterizedModel("grok-4.6[effort=high,fast=true]")).toEqual({ model: "grok-4.6", thinking: "high", fast: true });
    expect(splitParameterizedModel("claude-opus-5-5")).toEqual({ model: "claude-opus-5-5" });
  });
});

describe("defaults", () => {
  it("maps `cursor agent --model` ids onto Cursor ACP ids", () => {
    expect(mapCursorCliModel("cursor-grok-4.6-high-fast")).toBe("grok-4.6[effort=high,fast=true]");
    expect(mapCursorCliModel("cursor-grok-4.6-high")).toBe("grok-4.6[effort=high]");
    expect(mapCursorCliModel("grok-4.7[effort=low]")).toBe("grok-4.7[effort=low]");
    expect(defaultModelFor("cursor", {})).toBe("grok-4.6[effort=high]");
  });

  it("uses OpenCode's own configured model unless DevHub overrides it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-"));
    fs.mkdirSync(path.join(home, "opencode"));
    fs.writeFileSync(path.join(home, "opencode", "opencode.json"), JSON.stringify({ model: "openai-api/gpt-5.6-luna" }));
    expect(defaultModelFor("opencode", { XDG_CONFIG_HOME: home })).toBe("openai-api/gpt-5.6-luna");
    expect(defaultModelFor("opencode", { XDG_CONFIG_HOME: home, DEVHUB_AGENT_OPENCODE_MODEL: "opencode-go/kimi" })).toBe("opencode-go/kimi");
    expect(defaultModelFor("opencode", { XDG_CONFIG_HOME: path.join(home, "missing") })).toBeUndefined();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("treats the older chatgpt id as Codex", () => {
    expect(resolveBackgroundCli({ DEVHUB_AGENT_CLI: "ChatGPT" })).toBe("codex");
    expect(resolveBackgroundCli({})).toBe("cursor");
  });
});

describe("resolvePaseoLaunch", () => {
  it("uses each harness's full-auto mode and flags Cursor for auto-confirm", () => {
    const claude = resolvePaseoLaunch({ provider: "claude", model: "haiku", mcpNames: [], depth: 0 });
    expect(claude.config).toMatchObject({ provider: "claude/haiku", modeId: "bypassPermissions" });
    expect(claude.autoconfirmPermissions).toBe(false);
    const cursor = resolvePaseoLaunch({ provider: "Cursor", model: "grok-4.6[effort=high]", mcpNames: [], depth: 0 });
    expect(cursor.config).toMatchObject({ provider: "cursor/grok-4.6", modeId: "agent", thinkingOptionId: "high" });
    expect(cursor.autoconfirmPermissions).toBe(true);
    expect(cursor.config.featureValues).toEqual({ auto_accept: true });
    expect(resolvePaseoLaunch({ provider: "cursor", model: "grok-4.6[effort=high,fast=true]", mcpNames: [], depth: 0 }).config.featureValues).toEqual({ auto_accept: true, fast: true });
    expect(resolvePaseoLaunch({ provider: "chatgpt", mcpNames: [], depth: 0 }).config).toMatchObject({ provider: "codex/default", modeId: "full-access" });
  });

  it("falls back to the provider's default model only when DevHub has none", () => {
    expect(resolvePaseoLaunch({ provider: "claude", mcpNames: [], depth: 0 }).config.provider).toBe("claude/default");
    expect(resolvePaseoLaunch({ provider: "cursor", mcpNames: [], depth: 0, env: {} }).config).toMatchObject({ provider: "cursor/grok-4.6", thinkingOptionId: "high" });
  });

  it("marks the agent and its DevHub MCP one level deeper, so nested dispatch stays bounded", () => {
    const launch = resolvePaseoLaunch({ provider: "claude", model: "haiku", mcpNames: ["devhub"], depth: 0 });
    expect(launch.env).toEqual({ DEVHUB_AGENT_DEPTH: "1" });
    const devhub = launch.config.mcpServers?.devhub;
    expect(devhub?.type).toBe("stdio");
    expect(devhub && "env" in devhub ? devhub.env?.DEVHUB_AGENT_DEPTH : undefined).toBe("1");
  });

  it("gives Cursor the slimmed DevHub catalog its tool budget needs, and Claude the full one", () => {
    const envOf = (provider: string) => {
      const server = resolvePaseoLaunch({ provider, model: "m", mcpNames: ["devhub"], depth: 0 }).config.mcpServers?.devhub;
      return server && "env" in server ? server.env : undefined;
    };
    expect(envOf("cursor")?.DEVHUB_MCP_TOOLSETS).toBeTruthy();
    expect(envOf("claude")?.DEVHUB_MCP_TOOLSETS).toBeUndefined();
  });

  it("rejects ids Paseo would refuse", () => {
    expect(() => resolvePaseoLaunch({ provider: "../claude", mcpNames: [], depth: 0 })).toThrow(/not a Paseo provider id/);
  });
});
