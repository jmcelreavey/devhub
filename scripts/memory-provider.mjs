#!/usr/bin/env node
/**
 * Switch this machine's agent-memory provider: agentmemory, claude-mem, or none.
 *
 *   npm run memory -- status
 *   npm run memory -- use claude-mem [--dry-run]
 *   npm run memory -- use agentmemory
 *   npm run memory -- use none
 *
 * One at a time, on purpose: two providers both injecting remembered context
 * into the same session is noise, and two capturing the same work is double
 * the cost. `use X` turns every other provider off first, then turns X on.
 *
 * Nothing is deleted. agentmemory's MCP entry is parked as
 * `~/.config/devhub/mcp-personal/agentmemory.json.disabled` (DevHub only reads
 * `*.json`), its launchd job is disabled rather than removed, and its data in
 * `~/.agentmemory` is never touched.
 *
 * Planning is separate from running so the plan can be tested, and printed with
 * `--dry-run`, without changing the machine.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pinned: the installer pulls Bun and uv and registers hooks, so it shouldn't float. */
export const CLAUDE_MEM_VERSION = "13.29.0";
export const PROVIDERS = ["agentmemory", "claude-mem"];

/** Tools DevHub syncs MCP config to. Claude Code is handled through its own CLI instead. */
const SYNC_TOOLS = ["claude-desktop", "codex", "cursor", "opencode", "antigravity"];
/** Shipped by the Codex app itself; they look like ours and a prune would delete them. */
const KEEP_SERVERS = ["node_repl", "computer-use"];

const AGENTMEMORY_URL = "http://localhost:3111";
const AGENTMEMORY_LABEL = "dev.agentmemory";
const CLAUDE_MEM_PORT = 37702;

const AGENTMEMORY_SERVER = {
  command: "npx",
  args: ["-y", "@agentmemory/mcp"],
  env: { AGENTMEMORY_URL },
};

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function defaultContext() {
  return {
    home: os.homedir(),
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    repoRoot: path.resolve(HERE, ".."),
    platform: process.platform,
  };
}

function personalMcpPaths(home) {
  const dir = path.join(home, ".config", "devhub", "mcp-personal");
  return { on: path.join(dir, "agentmemory.json"), off: path.join(dir, "agentmemory.json.disabled") };
}

/** Park or restore agentmemory's DevHub personal MCP entry. Returns what happened. */
export function setPersonalMcp(mode, home) {
  const { on, off } = personalMcpPaths(home);
  if (mode === "disable") {
    if (!fs.existsSync(on)) return fs.existsSync(off) ? "already disabled" : "nothing to disable";
    fs.renameSync(on, off);
    return "disabled";
  }
  if (fs.existsSync(on)) return "already enabled";
  if (fs.existsSync(off)) {
    fs.renameSync(off, on);
    return "enabled";
  }
  fs.mkdirSync(path.dirname(on), { recursive: true });
  fs.writeFileSync(on, `${JSON.stringify(AGENTMEMORY_SERVER, null, 2)}\n`);
  return "enabled (recreated)";
}

function syncStep(ctx, flags, label) {
  const tsx = path.join(ctx.repoRoot, "dashboard", "node_modules", ".bin", "tsx");
  return {
    label,
    exec: [
      tsx,
      "--tsconfig",
      path.join(ctx.repoRoot, "dashboard", "tsconfig.json"),
      path.join(ctx.repoRoot, "scripts", "install_mcp_configs.ts"),
      ...SYNC_TOOLS.flatMap((tool) => ["--tool", tool]),
      ...flags,
    ],
  };
}

const claudeMem = (...args) => ["npx", "--yes", `claude-mem@${CLAUDE_MEM_VERSION}`, ...args];

/** `tolerate`: a failure here is normal (already stopped, already added) and shouldn't stop the switch. */
export function planFor(provider, action, ctx = defaultContext()) {
  const darwin = ctx.platform === "darwin";
  const domain = `gui/${ctx.uid}/${AGENTMEMORY_LABEL}`;
  const plist = path.join(ctx.home, "Library", "LaunchAgents", `${AGENTMEMORY_LABEL}.plist`);

  if (provider === "agentmemory" && action === "disable") {
    return [
      { label: "Park DevHub's agentmemory MCP entry", personalMcp: "disable" },
      syncStep(ctx, KEEP_SERVERS.flatMap((name) => ["--exclude", name]), "Remove it from Cursor, Codex, OpenCode, Claude Desktop, Antigravity"),
      { label: "Remove it from Claude Code", exec: ["claude", "mcp", "remove", "agentmemory", "-s", "user"], tolerate: true },
      ...(darwin
        ? [
            { label: "Stop the agentmemory service", exec: ["launchctl", "bootout", domain], tolerate: true },
            { label: "Keep it from starting at login", exec: ["launchctl", "disable", domain], tolerate: true },
          ]
        : []),
      { label: "Stop its engine process", exec: ["pkill", "-f", "iii --config .*agentmemory"], tolerate: true },
    ];
  }

  if (provider === "agentmemory" && action === "enable") {
    return [
      { label: "Restore DevHub's agentmemory MCP entry", personalMcp: "enable" },
      syncStep(ctx, ["--no-prune"], "Add it to Cursor, Codex, OpenCode, Claude Desktop, Antigravity"),
      {
        label: "Add it to Claude Code",
        exec: ["claude", "mcp", "add", "agentmemory", "-s", "user", "-e", `AGENTMEMORY_URL=${AGENTMEMORY_URL}`, "--", "npx", "-y", "@agentmemory/mcp"],
        tolerate: true,
      },
      ...(darwin
        ? [
            { label: "Allow the agentmemory service at login", exec: ["launchctl", "enable", domain], tolerate: true },
            { label: "Start the agentmemory service", exec: ["launchctl", "bootstrap", `gui/${ctx.uid}`, plist], tolerate: true },
          ]
        : []),
    ];
  }

  if (provider === "claude-mem" && action === "enable") {
    return [
      // `--provider claude` is the local one: the default provider sends session content to cmem.ai.
      { label: "Install claude-mem for Claude Code (local provider)", exec: claudeMem("install", "--ide", "claude-code", "--provider", "claude") },
      { label: "Turn its telemetry off", exec: claudeMem("telemetry", "disable"), tolerate: true },
      { label: "Start its worker", exec: claudeMem("start") },
    ];
  }

  if (provider === "claude-mem" && action === "disable") {
    return [
      { label: "Stop the claude-mem worker", exec: claudeMem("stop"), tolerate: true },
      { label: "Remove claude-mem's plugin and configs", exec: claudeMem("uninstall"), tolerate: true },
    ];
  }

  throw new Error(`Unknown provider/action: ${provider} ${action}`);
}

/** Every other provider off, then the chosen one on. `none` is just the first half. */
export function planUse(choice, ctx = defaultContext()) {
  if (choice !== "none" && !PROVIDERS.includes(choice)) {
    throw new Error(`Unknown provider "${choice}". Use one of: ${[...PROVIDERS, "none"].join(", ")}.`);
  }
  const steps = PROVIDERS.filter((provider) => provider !== choice).flatMap((provider) =>
    planFor(provider, "disable", ctx).map((step) => ({ ...step, label: `[${provider} off] ${step.label}` })),
  );
  if (choice !== "none") {
    steps.push(...planFor(choice, "enable", ctx).map((step) => ({ ...step, label: `[${choice} on] ${step.label}` })));
  }
  return steps;
}

function runStep(step, ctx, dryRun) {
  if (dryRun) {
    console.log(`  would: ${step.label}`);
    if (step.exec) console.log(`         $ ${step.exec.join(" ")}`);
    return true;
  }
  console.log(`  ${step.label}`);
  if (step.personalMcp) {
    console.log(`    → ${setPersonalMcp(step.personalMcp, ctx.home)}`);
    return true;
  }
  const [cmd, ...args] = step.exec;
  // stdin closed so an installer can't sit waiting on a prompt nobody will see.
  const result = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], cwd: ctx.repoRoot, timeout: 600_000 });
  if (result.status === 0) return true;
  const why = result.error ? result.error.message : `exit ${result.status}`;
  console.log(`    ${step.tolerate ? "(ignored)" : "FAILED"}: ${why}`);
  return step.tolerate === true;
}

export function runPlan(steps, ctx, dryRun) {
  for (const step of steps) {
    if (!runStep(step, ctx, dryRun)) {
      console.error(`\nStopped at: ${step.label}. Nothing after it ran; re-run once it's sorted.`);
      return 1;
    }
  }
  return 0;
}

async function workerUp(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

function succeeds(cmd, args) {
  return spawnSync(cmd, args, { stdio: "ignore", timeout: 5_000 }).status === 0;
}

async function status(ctx) {
  const { on, off } = personalMcpPaths(ctx.home);
  const personal = fs.existsSync(on) ? "enabled" : fs.existsSync(off) ? "parked" : "absent";
  const launchd = ctx.platform === "darwin" ? (succeeds("launchctl", ["list", AGENTMEMORY_LABEL]) ? "loaded" : "not loaded") : "n/a";
  const inClaude = succeeds("claude", ["mcp", "get", "agentmemory"]) ? "yes" : "no";
  console.log("agentmemory");
  console.log(`  DevHub MCP entry: ${personal}`);
  console.log(`  launchd service:  ${launchd}`);
  console.log(`  in Claude Code:   ${inClaude}`);
  const installed = fs.existsSync(path.join(ctx.home, ".claude", "plugins", "marketplaces", "thedotmack"));
  console.log("claude-mem");
  console.log(`  plugin installed: ${installed ? "yes" : "no"}`);
  console.log(`  worker :${CLAUDE_MEM_PORT}:      ${(await workerUp(CLAUDE_MEM_PORT)) ? "running" : "not running"}`);
}

async function main(argv) {
  const [command, choice, ...rest] = argv;
  const ctx = defaultContext();
  if (command === "status") return void (await status(ctx));
  if (command === "use" && choice) {
    const dryRun = rest.includes("--dry-run");
    const steps = planUse(choice, ctx);
    console.log(`${dryRun ? "Plan for" : "Switching to"} ${choice}:`);
    return process.exit(runPlan(steps, ctx, dryRun));
  }
  console.error("Usage: memory-provider.mjs status | use <agentmemory|claude-mem|none> [--dry-run]");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
