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

// --- OpenChamber integration ---
const OC_THEMES_SRC = path.join(DASHBOARD_DIR, "config/openchamber-themes");
const OC_THEMES_DEST = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".config/openchamber/themes",
);
const OC_INDEX_HTML = path.join(
  DASHBOARD_DIR,
  "node_modules/@openchamber/web/dist/index.html",
);
const OC_THEME_INJECT_MARKER = "<!-- DEVHUB_THEME_DEFAULTS -->";

/** Read theme metadata.id from every .json in the source dir. */
function discoverThemeIds(): { dark: string | null; light: string | null } {
  if (!fs.existsSync(OC_THEMES_SRC)) return { dark: null, light: null };
  const ids: Record<string, string> = {};
  for (const f of fs.readdirSync(OC_THEMES_SRC)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(OC_THEMES_SRC, f), "utf8"),
      );
      const id = raw?.metadata?.id;
      const variant = raw?.metadata?.variant;
      if (id && (variant === "dark" || variant === "light")) {
        ids[variant] = id;
      }
    } catch {
      // skip malformed json
    }
  }
  return { dark: ids.dark ?? null, light: ids.light ?? null };
}

/** Copy all theme .json files to the user's OpenChamber themes directory. */
function installOpenChamberThemes(): void {
  if (!fs.existsSync(OC_THEMES_SRC) || !OC_THEMES_DEST) return;
  fs.mkdirSync(OC_THEMES_DEST, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(OC_THEMES_SRC)) {
    if (!f.endsWith(".json")) continue;
    fs.copyFileSync(path.join(OC_THEMES_SRC, f), path.join(OC_THEMES_DEST, f));
    count++;
  }
  if (count > 0) log(`OpenChamber themes installed (${count})`);
}

/**
 * Patch the OpenChamber index.html so first-time users get our default theme.
 * Only writes once (guarded by marker); respects existing user choices.
 */
function setDefaultOpenChamerTheme(): void {
  if (!fs.existsSync(OC_INDEX_HTML)) return;
  const { dark, light } = discoverThemeIds();
  if (!dark && !light) return;

  let html = fs.readFileSync(OC_INDEX_HTML, "utf8");
  if (html.includes(OC_THEME_INJECT_MARKER)) return;

  const sets: string[] = [];
  if (dark) sets.push(`if(!localStorage.getItem('darkThemeId'))localStorage.setItem('darkThemeId','${dark}')`);
  if (light) sets.push(`if(!localStorage.getItem('lightThemeId'))localStorage.setItem('lightThemeId','${light}')`);
  if (dark || light) sets.push(`if(!localStorage.getItem('themeMode'))localStorage.setItem('themeMode','dark')`);

  const script = `<script>\n(function(){try{${sets.join(";")}}catch(e){}})();\n</script>`;
  html = html.replace(
    "<head>",
    `<head>\n    ${OC_THEME_INJECT_MARKER}\n    ${script}`,
  );
  fs.writeFileSync(OC_INDEX_HTML, html);
  log("OpenChamber default theme injected");
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

// --- 4. OpenChamber theme ---
installOpenChamberThemes();
setDefaultOpenChamerTheme();

log("Done");
