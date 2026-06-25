#!/usr/bin/env node
/**
 * postinstall — runs automatically after `npm install` / `npm ci`.
 *
 * Minimal bootstrap: .env.local, notes dirs, git hooks, OpenChamber theme.
 * Full sync/MCP/build runs from `bash scripts/install.sh` (TypeScript bootstrap)
 * or Actions in the app.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import process from "node:process";
import { applyOpenChamberTheme } from "../lib/openchamber-theme";
import { materializeBranding } from "../lib/plugins/branding";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(scriptDir, "../..");
const DASHBOARD_DIR = path.resolve(scriptDir, "..");
const ENV_LOCAL = path.join(DASHBOARD_DIR, ".env.local");
const ENV_EXAMPLE = path.join(DASHBOARD_DIR, ".env.example");

function log(msg: string): void {
  process.stdout.write(`[postinstall] ${msg}\n`);
}

function warn(msg: string): void {
  process.stderr.write(`[postinstall] WARNING: ${msg}\n`);
}

// Skip in CI or when explicitly disabled
if (process.env.CI || process.env.DEVHUB_SKIP_POSTINSTALL) {
  process.exit(0);
}

// --- 1. Bootstrap .env.local ---
if (!fs.existsSync(ENV_LOCAL) && fs.existsSync(ENV_EXAMPLE)) {
  log("Creating .env.local from .env.example...");
  let content = fs.readFileSync(ENV_EXAMPLE, "utf8");
  content = content.replace(/^NOTES_DIR=.*$/m, `NOTES_DIR=${REPO_ROOT}/notes`);
  content = content.replace(/^DOCS_DIR=.*$/m, `DOCS_DIR=${REPO_ROOT}/docs`);
  content = content.replace(/^REPO_ROOT=.*$/m, `REPO_ROOT=${REPO_ROOT}`);
  fs.writeFileSync(ENV_LOCAL, content);
}

// --- 2. Notes directories ---
for (const dir of ["notes/sessions/archive", "notes/learnings/archive"]) {
  const full = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true });
    log(`Created ${dir}`);
  }
}

// --- 3. Git hooks ---
const hooksDir = path.join(REPO_ROOT, ".githooks");
if (fs.existsSync(hooksDir)) {
  try {
    for (const f of fs.readdirSync(hooksDir)) {
      fs.chmodSync(path.join(hooksDir, f), 0o755);
    }
    execSync("git config core.hooksPath .githooks", {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    log("Git hooks enabled");
  } catch {
    warn("Could not configure git hooks");
  }
}

// --- 4. OpenChamber theme (core default) ---
applyOpenChamberTheme(DASHBOARD_DIR, log);

// --- 5. Plugin branding (whitelabel theme/logo/fonts/OpenChamber, if a plugin opts in) ---
try {
  materializeBranding({ repoRoot: REPO_ROOT, emit: log });
} catch (e) {
  warn(`Plugin branding skipped: ${e instanceof Error ? e.message : String(e)}`);
}

log("Done");
