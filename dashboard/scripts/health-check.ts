#!/usr/bin/env tsx
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { augmentedPathEnv } from "../lib/process-env";

const exec = promisify(execFile);

interface Issue {
  level: "fatal" | "warn";
  msg: string;
}

function execOut(bin: string, args: string[], opts: { cwd?: string } = {}): Promise<string> {
  return exec(bin, args, {
    cwd: opts.cwd,
    env: augmentedPathEnv(),
    timeout: 5_000,
  }).then((r) => r.stdout.trim());
}

const issues: Issue[] = [];

/**
 * On first run (.env.local missing) bootstrap a sensible default file so
 * `npm run dev` / `npm run start` work without forcing a trip through
 * install.sh. Mirrors what install.sh does for full installs.
 */
function bootstrapEnvLocal(envLocal: string): boolean {
  if (fs.existsSync(envLocal)) return false;
  const dashboardDir = process.cwd();
  const repoRoot = path.resolve(dashboardDir, "..");
  const example = path.join(dashboardDir, ".env.example");
  const lines: string[] = [
    `NOTES_DIR=${path.join(repoRoot, "notes")}`,
    `DOCS_DIR=${path.join(repoRoot, "docs")}`,
    `REPO_ROOT=${repoRoot}`,
    "PORT=1337",
    "",
    "# Optional — Google Calendar (configure from /setup)",
    "# GOOGLE_CLIENT_ID=",
    "# GOOGLE_CLIENT_SECRET=",
    "# GOOGLE_REFRESH_TOKEN=",
    "",
    "# Optional — Jira (configure from /setup)",
    "# JIRA_DOMAIN=",
    "# JIRA_EMAIL=",
    "# JIRA_API_TOKEN=",
    "",
  ];
  // If .env.example exists, prefer the keys from it but use our resolved paths.
  if (fs.existsSync(example)) {
    // Just write our template — the example is essentially the same shape.
  }
  fs.writeFileSync(envLocal, lines.join("\n"), "utf-8");
  return true;
}

const envLocal = path.resolve(process.cwd(), ".env.local");
const created = bootstrapEnvLocal(envLocal);

function check(level: "fatal" | "warn", cond: boolean, msg: string): void {
  if (!cond) issues.push({ level, msg });
}

function envOrEmpty(name: string): string {
  return process.env[name] ?? "";
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function main() {
  await loadEnvWithOnePasswordFallback(process.cwd());

  if (created) {
    console.log("  · First run — created dashboard/.env.local with sane defaults.");
    console.log("  · Configure optional integrations from http://localhost:1337/setup");
  }

  // HOME
  check("fatal", !!envOrEmpty("HOME"), "HOME environment variable is not set.");

  // NOTES_DIR
  const notesDir = envOrEmpty("NOTES_DIR");
  if (!notesDir) {
    issues.push({
      level: "fatal",
      msg: "NOTES_DIR is not set. Add it to dashboard/.env.local (or delete the file and re-run to regenerate).",
    });
  } else {
    const resolved = path.resolve(notesDir);
    if (!fs.existsSync(resolved)) {
      try {
        fs.mkdirSync(resolved, { recursive: true });
        console.log(`  · Created notes dir: ${resolved}`);
      } catch (e) {
        issues.push({
          level: "fatal",
          msg: `NOTES_DIR (${resolved}) does not exist and could not be created: ${(e as Error).message}`,
        });
      }
    }
  }

  // Docs (DOCS_DIR optional — defaults to REPO_ROOT/docs)
  {
    const { getDocsDir } = await import("../lib/content-dirs");
    const resolved = getDocsDir();
    if (!fs.existsSync(resolved)) {
      issues.push({
        level: "warn",
        msg: `Docs directory not found: ${resolved}`,
      });
    }
  }

  // REPO_ROOT — required so server-side scripts can locate the repo.
  const repoRoot = envOrEmpty("REPO_ROOT");
  if (repoRoot) {
    const resolved = path.resolve(repoRoot);
    check("fatal", fs.existsSync(resolved), `REPO_ROOT (${resolved}) does not exist.`);
  } else {
    issues.push({
      level: "warn",
      msg: "REPO_ROOT is not set — falling back to the dashboard parent directory.",
    });
  }

  const bindHost = (process.env.DEVHUB_BIND_HOST ?? "").trim();
  if (bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1") {
    issues.push({
      level: "warn",
      msg: "DEVHUB_BIND_HOST is localhost-only — phones/LAN URLs will not connect. In /setup enable “Allow access from other devices on my network”, or remove DEVHUB_BIND_HOST from .env.local, then restart.",
    });
  }

  // PORT
  const portRaw = envOrEmpty("PORT") || "1337";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    issues.push({ level: "fatal", msg: `PORT (${portRaw}) is not a valid port number.` });
  } else {
    const free = await portFree(port);
    if (!free) {
      issues.push({
        level: "warn",
        msg: `Port ${port} is already in use. The Next.js server may pick a different port.`,
      });
    }
  }

  // Optional integrations
  const jiraVars = ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"];
  const jiraSet = jiraVars.filter((k) => envOrEmpty(k)).length;
  if (jiraSet > 0 && jiraSet < jiraVars.length) {
    issues.push({
      level: "warn",
      msg: `Jira partially configured: set all of ${jiraVars.join(", ")} or none.`,
    });
  }

  const googleVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
  const googleSet = googleVars.filter((k) => envOrEmpty(k)).length;
  if (googleSet > 0 && googleSet < googleVars.length) {
    issues.push({
      level: "warn",
      msg: `Google Calendar partially configured: set all of ${googleVars.join(", ")} or none.`,
    });
  }

  // Notes MCP server dependencies — stdio server needs its own node_modules.
  {
    const notesServer = path.join(path.resolve(repoRoot || process.cwd(), ".."), "mcp-servers", "notes-server");
    if (fs.existsSync(notesServer) && !fs.existsSync(path.join(notesServer, "node_modules"))) {
      console.log("  · Installing notes server dependencies...");
      try {
        await exec("npm", ["install", "--silent"], { cwd: notesServer });
      } catch {
        issues.push({
          level: "warn",
          msg: "Notes server npm install failed — MCP tools may not work. Run: cd mcp-servers/notes-server && npm install",
        });
      }
    }
  }

  // GitHub CLI auth — the standup PR sections and the /prs page rely on this.
  // Warn (not fatal) because the dashboard still boots without it.
  try {
    await execOut("gh", ["auth", "status", "--hostname", "github.com"]);
  } catch {
    issues.push({
      level: "warn",
      msg: "GitHub CLI (`gh`) is not authenticated. Run `gh auth login` to enable standup PR sections and the /prs page.",
    });
  }

  // git user.email — the standup commit filter substring-matches on this,
  // so a missing value silently produces an empty git section.
  const repoRootResolved = repoRoot ? path.resolve(repoRoot) : null;
  if (repoRootResolved && fs.existsSync(repoRootResolved)) {
    try {
      const email = await execOut("git", ["config", "user.email"], { cwd: repoRootResolved });
      if (!email) {
        issues.push({
          level: "warn",
          msg: "`git config user.email` is empty — the standup commit filter won't match anything. Set it with `git config --global user.email \"you@example.com\"`.",
        });
      }
    } catch {
      issues.push({
        level: "warn",
        msg: "Could not read `git config user.email`. Standup commit filtering may produce empty output.",
      });
    }
  }

  const fatal = issues.filter((i) => i.level === "fatal");
  const warn = issues.filter((i) => i.level === "warn");

  if (fatal.length > 0) {
    console.error("\nDevHub: setup issues need attention:");
    for (const i of fatal) console.error(`  ✗ ${i.msg}`);
    if (warn.length > 0) {
      for (const i of warn) console.error(`  ⚠ ${i.msg}`);
    }
    console.error("\nRun `npm run doctor` for a full diagnostic.");
    process.exit(1);
  }

  if (warn.length > 0) {
    for (const i of warn) console.log(`  ⚠ ${i.msg}`);
  }

  console.log(`DevHub ready on http://localhost:${port}`);
  if (process.env.WSL_DISTRO_NAME) {
    console.log(
      "  · WSL2: phones use your Windows LAN IP (see README). Mirrored .wslconfig or scripts/wsl/forward-devhub.ps1.",
    );
  }
}

main().catch((e) => {
  console.error("Health check failed:", e);
  process.exit(1);
});
