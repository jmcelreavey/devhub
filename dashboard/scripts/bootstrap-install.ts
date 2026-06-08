#!/usr/bin/env tsx
/**
 * Full machine bootstrap after dashboard deps are installed (`npm ci` in dashboard/).
 * Invoked from `scripts/install.sh`. Keeps orchestration in TypeScript, not shell.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import process from "node:process";
import { syncSkills } from "../lib/sync-skills";
import { syncPersona } from "../lib/sync-persona";
import { syncMcpServers } from "../lib/sync-mcp";
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

function run(cmd: string, opts: { cwd: string; label: string }): void {
  try {
    execSync(cmd, { cwd: opts.cwd, stdio: "inherit" });
  } catch {
    warn(`${opts.label} failed — see output above`);
  }
}

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  ensureEnvLocal();
  ensureNoteDirs();

  log("Syncing skills...");
  const sk = await syncSkills({ emit, repoRoot: REPO_ROOT, prune: false });
  if (sk !== 0) warn("Skill sync had issues");

  log("Syncing persona...");
  const pe = await syncPersona({ emit, repoRoot: REPO_ROOT });
  if (pe !== 0) warn("Persona sync had issues");

  log("Installing MCP configs...");
  const mcp = await syncMcpServers({ emit, repoRoot: REPO_ROOT, prune: true });
  if (mcp !== 0) warn("MCP sync had issues");

  const notesServer = path.join(REPO_ROOT, "mcp-servers", "notes-server");
  if (fs.existsSync(notesServer)) {
    log("Installing notes server dependencies...");
    run("npm install --silent", { cwd: notesServer, label: "Notes server npm install" });
  }

  log("Building dashboard...");
  run("npm run build --silent", { cwd: DASHBOARD_DIR, label: "Dashboard build" });

  log("Running validation...");
  const v = await validateRepo({ emit, repoRoot: REPO_ROOT });
  if (v !== 0) warn("Validation found issues");
}

main().catch((err) => {
  warn(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
