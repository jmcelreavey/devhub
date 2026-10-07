import assert from "node:assert/strict";
import { test } from "node:test";
import { codexCandidates, managedPaseoConfig, paseoDaemonArgs } from "./paseo-config.mjs";
const options = { port: 6767, passwordHash: "hash", cursor: "/bin/cursor-agent", codex: "/Applications/ChatGPT.app/Contents/Resources/codex" };
test("detects Codex bundled in system and user applications", () => {
  assert.ok(codexCandidates("/users/test").includes("/Applications/ChatGPT.app/Contents/Resources/codex"));
  assert.ok(codexCandidates("/users/test").includes("/users/test/Applications/Codex.app/Contents/Resources/codex"));
});
test("installs missing providers without losing user settings or plugins", () => {
  const current = { daemon: { mcp: { injectIntoAgents: true }, browserTools: { enabled: true } }, plugins: { example: { kind: "directory", path: "/plugin" } }, features: { dictation: { enabled: true } }, agents: { providers: { custom: { extends: "claude", label: "Custom" }, cursor: { command: ["/custom/cursor"], params: { supportsMcpServers: false } } } } };
  const next = managedPaseoConfig(current, options);
  assert.deepEqual(next.agents.providers.cursor, current.agents.providers.cursor);
  assert.deepEqual(next.agents.providers.custom, current.agents.providers.custom);
  assert.deepEqual(next.plugins, current.plugins);
  assert.equal(next.daemon.mcp.injectIntoAgents, true);
  assert.equal(next.features.dictation.enabled, true);
  assert.deepEqual(next.agents.providers.codex.command, [options.codex]);
});
test("supports the legacy flag and the config-based web UI used since Paseo 0.9", () => {
  assert.ok(paseoDaemonArgs("/cli", "/home", "0.8.0").includes("--web-ui"));
  assert.deepEqual(paseoDaemonArgs("/cli", "/home", "0.9.1"), ["/cli", "daemon", "run", "--home", "/home"]);
  assert.ok(!paseoDaemonArgs("/cli", "/home", "1.0.0").includes("--web-ui"));
  assert.equal(managedPaseoConfig({}, { ...options, webUiConfig: true }).features.webUi.enabled, true);
  assert.equal(managedPaseoConfig({}, options).features.webUi, undefined);
});
test("keeps a user-provided Codex command", () => {
  assert.deepEqual(managedPaseoConfig({ agents: { providers: { codex: { command: ["/custom/codex", "--profile", "work"] } } } }, options).agents.providers.codex.command, ["/custom/codex", "--profile", "work"]);
});
