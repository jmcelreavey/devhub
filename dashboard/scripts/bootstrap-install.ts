#!/usr/bin/env tsx
/**
 * Full machine bootstrap after dashboard deps are installed (`npm ci` in dashboard/).
 * Invoked from `scripts/install.sh`. Keeps orchestration in TypeScript, not shell.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execExternal } from "../lib/exec-external";
import { augmentedPathEnv } from "../lib/process-env";
import process from "node:process";
import { syncSkills } from "@/lib/sync/skills";
import { syncPersona } from "@/lib/sync/persona";
import { syncMcpServers } from "@/lib/sync/mcp";
import { pluginMcpServerDirs } from "../lib/plugin-mcp-deps";
import { validateRepo } from "../lib/validate";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(scriptDir, "..");
const REPO_ROOT = path.resolve(DASHBOARD_DIR, "..");
const ENV_LOCAL = path.join(DASHBOARD_DIR, ".env.local");
const ENV_EXAMPLE = path.join(DASHBOARD_DIR, ".env.example");

function log(msg: string): void {
  process.stdout.write(`[bootstrap] ${msg}\n`);
}

function warn(msg: string): void {
  process.stderr.write(`[bootstrap] WARNING: ${msg}\n`);
}

function ensureEnvLocal(): void {
  if (fs.existsSync(ENV_LOCAL) || !fs.existsSync(ENV_EXAMPLE)) return;
  log("Creating dashboard/.env.local from .env.example...");
  let content = fs.readFileSync(ENV_EXAMPLE, "utf8");
  content = content.replace(/^NOTES_DIR=.*$/m, `NOTES_DIR=${REPO_ROOT}/notes`);
  content = content.replace(/^DOCS_DIR=.*$/m, `DOCS_DIR=${REPO_ROOT}/docs`);
  content = content.replace(/^REPO_ROOT=.*$/m, `REPO_ROOT=${REPO_ROOT}`);
  fs.writeFileSync(ENV_LOCAL, content);
}

function ensureNoteDirs(): void {
  for (const dir of ["notes/sessions/archive", "notes/learnings/archive"]) {
    const full = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      log(`Created ${dir}`);
    }
  }
  const seedFiles = [
    "notes/index.json",
    "notes/learnings/engineering.json",
    "notes/learnings/tools.json",
    "notes/learnings/prompts.json",
    "notes/learnings/projects.json",
  ];
  for (const f of seedFiles) {
    const full = path.join(REPO_ROOT, f);
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, "[]");
      log(`Created ${f}`);
    }
  }
}

async function run(args: readonly string[], opts: { cwd: string; label: string; timeoutMs?: number }): Promise<void> {
  const { stdout, stderr } = await execExternal("npm", args, {
    cwd: opts.cwd,
    env: augmentedPathEnv(),
    timeoutMs: opts.timeoutMs ?? 180_000,
    maxBuffer: 10 * 1024 * 1024,
    label: opts.label,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  ensureEnvLocal();
  ensureNoteDirs();

  log("Syncing skills...");
  const sk = await syncSkills({ emit, repoRoot: REPO_ROOT, prune: false });
  if (sk !== 0) throw new Error("Skill sync failed — see output above");

  log("Syncing persona...");
  const pe = await syncPersona({ emit, repoRoot: REPO_ROOT });
  if (pe !== 0) throw new Error("Persona sync failed — see output above");

  log("Installing MCP configs...");
  const mcp = await syncMcpServers({ emit, repoRoot: REPO_ROOT, prune: true });
  if (mcp !== 0) throw new Error("MCP sync failed — see output above");

  const devhubServer = path.join(REPO_ROOT, "mcp-servers", "devhub-server");
  if (fs.existsSync(devhubServer)) {
    log("Installing DevHub MCP server dependencies...");
    await run(["install", "--silent"], { cwd: devhubServer, label: "DevHub MCP server npm install" });
  }

  // Plugin-contributed MCP servers (e.g. the BI plugin's devhub-bi-server) need their
  // own deps too.
  for (const { plugin, dir } of pluginMcpServerDirs()) {
    log(`Installing ${plugin} MCP server dependencies (${path.basename(dir)})...`);
    await run(["install", "--silent"], { cwd: dir, label: `${plugin} MCP server npm install` });
  }

  log("Building dashboard...");
  await run(["run", "build", "--silent"], { cwd: DASHBOARD_DIR, label: "Dashboard build", timeoutMs: 900_000 });

  log("Running validation...");
  const v = await validateRepo({ emit, repoRoot: REPO_ROOT });
  if (v !== 0) throw new Error("Validation failed — see output above");
}

main().catch((err) => {
  warn(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
