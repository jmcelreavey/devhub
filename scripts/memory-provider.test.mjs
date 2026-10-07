import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CLAUDE_MEM_VERSION, planFor, planUse, setPersonalMcp } from "./memory-provider.mjs";

const ctx = { home: "/home/me", uid: 501, repoRoot: "/repo", platform: "darwin" };
const labels = (steps) => steps.map((step) => step.label);
const execs = (steps) => steps.filter((step) => step.exec).map((step) => step.exec.join(" "));

test("turning agentmemory off removes it everywhere and keeps the Codex app's own servers", () => {
  const steps = planFor("agentmemory", "disable", ctx);
  assert.equal(steps[0].personalMcp, "disable");
  const sync = steps.find((step) => step.exec?.some((arg) => arg.endsWith("install_mcp_configs.ts")));
  assert.ok(sync, "syncs the other tools");
  assert.deepEqual(
    sync.exec.filter((arg, i) => sync.exec[i - 1] === "--exclude"),
    ["node_repl", "computer-use"],
  );
  assert.ok(!sync.exec.includes("--no-prune"), "removal needs the prune");
  assert.ok(!sync.exec.some((arg, i) => sync.exec[i - 1] === "--tool" && arg === "claude"), "Claude Code goes through its own CLI");
  assert.ok(execs(steps).includes("claude mcp remove agentmemory -s user"));
  assert.ok(execs(steps).includes("launchctl bootout gui/501/dev.agentmemory"));
  assert.ok(execs(steps).includes("launchctl disable gui/501/dev.agentmemory"));
});

test("turning agentmemory on only adds: no prune, service re-enabled", () => {
  const steps = planFor("agentmemory", "enable", ctx);
  assert.equal(steps[0].personalMcp, "enable");
  const sync = steps.find((step) => step.exec?.some((arg) => arg.endsWith("install_mcp_configs.ts")));
  assert.ok(sync.exec.includes("--no-prune"));
  const joined = execs(steps);
  assert.ok(joined.some((line) => line.startsWith("claude mcp add agentmemory -s user -e AGENTMEMORY_URL=http://localhost:3111 -- npx -y @agentmemory/mcp")));
  assert.ok(joined.includes("launchctl enable gui/501/dev.agentmemory"));
  assert.ok(joined.includes("launchctl bootstrap gui/501 /home/me/Library/LaunchAgents/dev.agentmemory.plist"));
});

test("claude-mem installs the local provider at a pinned version and switches telemetry off", () => {
  const joined = execs(planFor("claude-mem", "enable", ctx));
  assert.equal(joined[0], `npx --yes claude-mem@${CLAUDE_MEM_VERSION} install --ide claude-code --provider claude`);
  assert.ok(joined.some((line) => line.endsWith("telemetry disable")));
  assert.ok(joined.some((line) => line.endsWith(" start")));
  assert.ok(!joined.join("\n").includes("cmem"), "never the hosted provider");
});

test("claude-mem off stops the worker before uninstalling", () => {
  const joined = execs(planFor("claude-mem", "disable", ctx));
  assert.ok(joined[0].endsWith(" stop"));
  assert.ok(joined[1].endsWith(" uninstall"));
});

test("using one provider turns the other off first", () => {
  const steps = planUse("claude-mem", ctx);
  const firstOn = steps.findIndex((step) => step.label.startsWith("[claude-mem on]"));
  assert.ok(firstOn > 0);
  assert.ok(steps.slice(0, firstOn).every((step) => step.label.startsWith("[agentmemory off]")));
  assert.ok(steps.slice(firstOn).every((step) => step.label.startsWith("[claude-mem on]")));
});

test("using none turns everything off and enables nothing", () => {
  const steps = planUse("none", ctx);
  assert.ok(steps.some((step) => step.label.startsWith("[agentmemory off]")));
  assert.ok(steps.some((step) => step.label.startsWith("[claude-mem off]")));
  assert.ok(!labels(steps).some((label) => label.includes(" on]")));
});

test("an unknown provider is refused before anything runs", () => {
  assert.throws(() => planUse("mem0", ctx), /Unknown provider "mem0"/);
});

test("no launchd steps off macOS", () => {
  const steps = [...planFor("agentmemory", "disable", { ...ctx, platform: "linux" }), ...planFor("agentmemory", "enable", { ...ctx, platform: "linux" })];
  assert.ok(!execs(steps).some((line) => line.startsWith("launchctl")));
});

test("parking and restoring the personal MCP entry round-trips and never deletes it", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-memory-provider-"));
  try {
    const dir = path.join(home, ".config", "devhub", "mcp-personal");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "agentmemory.json"), '{"command":"custom"}');

    assert.equal(setPersonalMcp("disable", home), "disabled");
    assert.equal(setPersonalMcp("disable", home), "already disabled");
    assert.ok(!fs.existsSync(path.join(dir, "agentmemory.json")));

    assert.equal(setPersonalMcp("enable", home), "enabled");
    assert.equal(fs.readFileSync(path.join(dir, "agentmemory.json"), "utf8"), '{"command":"custom"}', "your own entry comes back, not a default");
    assert.equal(setPersonalMcp("enable", home), "already enabled");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("enabling with no entry anywhere recreates the default", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-memory-provider-"));
  try {
    assert.equal(setPersonalMcp("disable", home), "nothing to disable");
    assert.equal(setPersonalMcp("enable", home), "enabled (recreated)");
    const entry = JSON.parse(fs.readFileSync(path.join(home, ".config", "devhub", "mcp-personal", "agentmemory.json"), "utf8"));
    assert.deepEqual(entry.args, ["-y", "@agentmemory/mcp"]);
    assert.equal(entry.env.AGENTMEMORY_URL, "http://localhost:3111");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
