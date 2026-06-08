#!/usr/bin/env tsx
/**
 * `npm run doctor` — diagnose common DevHub setup issues.
 *
 * Checks: env vars, paths exist, port availability, node modules, build
 * artifact freshness, dashboard service state. Prints a punch list with
 * actionable fixes — never modifies anything.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getDocsDir } from "../lib/content-dirs";
import { checkOnePasswordStatus } from "./op-secrets";

interface Finding {
  level: "ok" | "warn" | "fail";
  area: string;
  msg: string;
  fix?: string;
}

const findings: Finding[] = [];
const cwd = process.cwd();
const repoRoot = path.resolve(cwd, "..");

function add(level: Finding["level"], area: string, msg: string, fix?: string): void {
  findings.push({ level, area, msg, fix });
}

function loadDotenv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}

function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  loadDotenv(path.join(cwd, ".env.local"));
  loadDotenv(path.join(cwd, ".env"));

  // Node version
  const node = process.versions.node;
  const major = Number.parseInt(node.split(".")[0] ?? "0", 10);
  if (major < 20) add("fail", "Node", `Node ${node} — Next 16 needs Node 20+`, "Use nvm: `nvm install 22 && nvm use 22`");
  else add("ok", "Node", `${node}`);

  // package.json + node_modules
  if (!exists(path.join(cwd, "package.json"))) {
    add("fail", "deps", "Run from dashboard/ — package.json not found here.");
  } else if (!isDir(path.join(cwd, "node_modules"))) {
    add("fail", "deps", "node_modules missing", "Run `npm install` at the repo root or in dashboard/");
  } else {
    add("ok", "deps", "node_modules present");
  }

  // .env.local
  const envLocal = path.join(cwd, ".env.local");
  if (!exists(envLocal)) {
    add("warn", "env", ".env.local missing", "Run `bash scripts/install.sh` from the repo root or copy dashboard/.env.example");
  } else {
    add("ok", "env", ".env.local exists");
  }

  // Required paths
  if (!process.env.NOTES_DIR) {
    add("fail", "env", "NOTES_DIR not set", "Add NOTES_DIR=… to .env.local");
  } else if (!isDir(process.env.NOTES_DIR)) {
    add("fail", "env", `NOTES_DIR points to nonexistent directory: ${process.env.NOTES_DIR}`);
  } else {
    add("ok", "env", `NOTES_DIR → ${process.env.NOTES_DIR}`);
  }

  {
    const docsResolved = getDocsDir();
    if (!isDir(docsResolved)) {
      add("fail", "env", `Docs directory not found: ${docsResolved}`);
    } else {
      const label = process.env.DOCS_DIR
        ? `DOCS_DIR → ${docsResolved}`
        : `docs → ${docsResolved} (default under REPO_ROOT)`;
      add("ok", "env", label);
    }
  }

  if (!process.env.REPO_ROOT) {
    add("warn", "env", "REPO_ROOT not set (will fall back to detected path)");
  } else if (!isDir(process.env.REPO_ROOT)) {
    add("fail", "env", `REPO_ROOT points to nonexistent directory: ${process.env.REPO_ROOT}`);
  } else {
    add("ok", "env", `REPO_ROOT → ${process.env.REPO_ROOT}`);
  }

  // Optional integrations
  const cal =
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET &&
    !!process.env.GOOGLE_REFRESH_TOKEN;
  add(cal ? "ok" : "warn", "integrations", cal ? "Google Calendar configured" : "Google Calendar not configured (optional)");
  const jira = !!process.env.JIRA_DOMAIN && !!process.env.JIRA_EMAIL && !!process.env.JIRA_API_TOKEN;
  add(jira ? "ok" : "warn", "integrations", jira ? "Jira configured" : "Jira not configured (optional)");

  // 1Password CLI
  const opItem = process.env.DEVHUB_OP_ITEM ?? "devhub";
  const opVault = process.env.DEVHUB_OP_VAULT;
  const { installed: opInstalled, signedIn: opSignedIn, itemFound: opItemFound } =
    await checkOnePasswordStatus(opItem, opVault);
  if (!opInstalled) {
    add(
      "warn",
      "1password",
      "1Password CLI (op) not found — secrets auto-fill disabled",
      "Install: https://developer.1password.com/docs/cli/get-started/",
    );
  } else if (!opSignedIn) {
    add("warn", "1password", "1Password CLI found but not signed in", "Run `op signin`");
  } else if (!opItemFound) {
    add(
      "warn",
      "1password",
      `Signed in but no "${opItem}" item found`,
      `Create a "${opItem}" item with fields named after your env vars (JIRA_API_TOKEN, etc.)` +
        (opVault ? "" : " — use DEVHUB_OP_VAULT to pin a vault"),
    );
  } else {
    add("ok", "1password", `"${opItem}" item found`);
  }

  // Build artifacts
  const buildId = path.join(cwd, ".next/BUILD_ID");
  if (exists(buildId)) {
    const age = Date.now() - fs.statSync(buildId).mtimeMs;
    const days = Math.round(age / 86_400_000);
    add(days > 7 ? "warn" : "ok", "build", `.next built ${days}d ago`, days > 7 ? "Run `npm run build` to refresh" : undefined);
  } else {
    add("warn", "build", ".next/BUILD_ID missing", "Run `npm run build`");
  }

  // Port
  const port = Number.parseInt(process.env.PORT ?? "1337", 10);
  if (await portInUse(port)) {
    add("ok", "port", `${port} is bound (server appears to be running)`);
  } else {
    add("warn", "port", `${port} is free`, "Start with `npm run dev` or `npm run start`");
  }

  const installSh = path.join(repoRoot, "scripts", "install.sh");
  if (!exists(installSh)) add("warn", "scripts", "scripts/install.sh not found at repo root");

  // Linux inotify watches — Next.js hot reload needs more than the default
  if (process.platform === "linux") {
    try {
      const maxWatches = fs.readFileSync("/proc/sys/fs/inotify/max_user_watches", "utf-8").trim();
      const count = Number.parseInt(maxWatches, 10);
      if (count < 524_288) {
        add("warn", "platform", `inotify max_user_watches is ${maxWatches} (recommended ≥ 524288)`, "Run: sudo sysctl fs.inotify.max_user_watches=524288");
      } else {
        add("ok", "platform", `inotify max_user_watches: ${maxWatches}`);
      }
    } catch {
      add("warn", "platform", "Could not read inotify settings", "If hot reload fails: sudo sysctl fs.inotify.max_user_watches=524288");
    }
  }

  // --- Fork workflow: is the public core wired as `upstream`? (no network) ---
  try {
    const upstream = spawnSync("git", ["-C", repoRoot, "remote", "get-url", "upstream"], {
      encoding: "utf-8",
    });
    if (upstream.status === 0) {
      add("ok", "upstream", `upstream → ${upstream.stdout.trim()}`);
    } else {
      add(
        "warn",
        "upstream",
        "No 'upstream' remote — devhub-update / devhub-backport need it.",
        "git remote add upstream https://github.com/<owner>/devhub.git",
      );
    }
  } catch {
    add("warn", "upstream", "Could not check git remotes");
  }

  // Print
  const PAD = 14;
  const ICONS: Record<Finding["level"], string> = { ok: "✓", warn: "⚠", fail: "✗" };
  const COLORS: Record<Finding["level"], string> = {
    ok: "\x1b[32m",
    warn: "\x1b[33m",
    fail: "\x1b[31m",
  };
  const RESET = "\x1b[0m";

  process.stdout.write("\nDevHub Doctor\n──────────────\n");
  for (const f of findings) {
    process.stdout.write(
      `${COLORS[f.level]}${ICONS[f.level]}${RESET} ${f.area.padEnd(PAD)}${f.msg}\n`,
    );
    if (f.fix) process.stdout.write(`  ${"".padEnd(PAD)}→ ${f.fix}\n`);
  }
  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  process.stdout.write(`\n${fails} failing, ${warns} warning, ${findings.length - fails - warns} ok\n`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`doctor crashed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
