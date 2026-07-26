import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SECRET_FILE_RE = /(^|[/\\])(\.env|\.npmrc|\.pypirc|id_rsa|id_ed25519|.*secret.*|.*token.*|.*credential.*)$/i;
const TEXT_EXTS = new Set([".md", ".mdx", ".txt", ".json", ".toml", ".yaml", ".yml"]);
const MAX_FILES_SCANNED = 2_000;
const MAX_SOURCE_CHARS = 120_000;

export interface RepoSnippet {
  relativePath: string;
  text: string;
}

export interface RepoContext {
  repoName: string;
  repoPath: string;
  scannedAt: string;
  headline: string;
  primaryStack: string[];
  packageManager: string | null;
  scripts: Record<string, string>;
  keyDirectories: string[];
  docs: string[];
  manifests: string[];
  testCommands: string[];
  runCommands: string[];
  recentCommits: string[];
  languageBreakdown: { extension: string; count: number }[];
  snippets: RepoSnippet[];
  openCodePrompt: string;
}

interface ScannedFile {
  relativePath: string;
  extension: string;
}

export async function getGitHead(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function scanRepoContext(repoPath: string): Promise<RepoContext> {
  const repoName = path.basename(repoPath);
  const files = scanRepoFiles(repoPath);
  const snippets = readUsefulSnippets(repoPath, files);
  const manifests = findManifests(files);
  const docs = findDocs(files);
  const packageJson = readPackageJson(repoPath);
  const scripts = packageJson?.scripts ?? {};
  const packageManager = detectPackageManager(files);
  const primaryStack = detectPrimaryStack(files, packageJson);
  const keyDirectories = detectKeyDirectories(files);
  const languageBreakdown = languageCounts(files);
  const testCommands = detectTestCommands(scripts, packageManager, files);
  const runCommands = detectRunCommands(scripts, packageManager, files);
  const recentCommits = await getRecentCommits(repoPath);
  const headline = buildHeadline(primaryStack, keyDirectories, docs, manifests);

  return {
    repoName,
    repoPath,
    scannedAt: new Date().toISOString(),
    headline,
    primaryStack,
    packageManager,
    scripts,
    keyDirectories,
    docs,
    manifests,
    testCommands,
    runCommands,
    recentCommits,
    languageBreakdown,
    snippets,
    openCodePrompt: buildOpenCodePrompt(repoName),
  };
}

/** Deterministic excerpt files appended to the NotebookLM pack ZIP. */
export function buildSnippetPackFiles(snippets: RepoSnippet[]): { path: string; content: string }[] {
  return snippets.map((snippet) => {
    const safeName = snippet.relativePath.replace(/[/\\]/g, "-");
    return {
      path: `05-source-excerpts/${safeName}.md`,
      content: `# ${snippet.relativePath}\n\n${snippet.text}`,
    };
  });
}

export function buildNotebookImportReadme(repoName: string): string {
  return [
    `# NotebookLM import: ${repoName}`,
    "",
    "This ZIP contains multiple Markdown sources for a NotebookLM notebook.",
    "",
    "## How to import",
    "",
    "1. **NotebookLM Tools extension** (recommended): use its ZIP import to upload all `.md` files as separate sources.",
    "2. **Manual**: unzip and upload individual files in the NotebookLM Add source dialog.",
    "",
    "Note: Google NotebookLM does not accept ZIP files natively.",
    "Free plan: up to 50 sources per notebook. Split or pick files if you hit the limit.",
    "",
    "Secrets, build output, and dependencies are intentionally excluded.",
  ].join("\n");
}

export function buildOpenCodePrompt(repoName: string): string {
  return [
    `You are helping me get up to speed on the ${repoName} codebase.`,
    "Read the repo first, then produce:",
    "1. a concise architecture map with the important files/directories;",
    "2. exact run/test/build commands and setup gotchas;",
    "3. a prioritized reading path for a new contributor;",
    "4. five quiz questions, one at a time, with answers grounded in file references.",
    "Do not modify files.",
  ].join("\n");
}

/** Compact JSON for model prompts — omits full snippet bodies (those are passed separately). */
export function compactContextForModel(context: RepoContext): Record<string, unknown> {
  return {
    repoName: context.repoName,
    repoPath: context.repoPath,
    headline: context.headline,
    primaryStack: context.primaryStack,
    packageManager: context.packageManager,
    scripts: context.scripts,
    keyDirectories: context.keyDirectories,
    docs: context.docs,
    manifests: context.manifests,
    testCommands: context.testCommands,
    runCommands: context.runCommands,
    recentCommits: context.recentCommits,
    languageBreakdown: context.languageBreakdown,
  };
}

function scanRepoFiles(repoPath: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  const queue = [repoPath];

  while (queue.length > 0 && out.length < MAX_FILES_SCANNED) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (out.length >= MAX_FILES_SCANNED) break;
      const absolute = path.join(dir, entry.name);
      const relativePath = path.relative(repoPath, absolute).split(path.sep).join("/");
      if (SECRET_FILE_RE.test(relativePath)) continue;

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      out.push({ relativePath, extension: path.extname(entry.name).toLowerCase() || "[none]" });
    }
  }

  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function readUsefulSnippets(repoPath: string, files: ScannedFile[]): RepoSnippet[] {
  const preferred = files.filter((file) => {
    const base = path.basename(file.relativePath).toLowerCase();
    return (
      base.startsWith("readme") ||
      base === "agents.md" ||
      base === "claude.md" ||
      base === "package.json" ||
      base === "pyproject.toml" ||
      base === "cargo.toml" ||
      base === "go.mod" ||
      file.relativePath.startsWith("docs/")
    );
  });

  const snippets: RepoSnippet[] = [];
  let remaining = MAX_SOURCE_CHARS;
  for (const file of preferred) {
    if (remaining <= 0) break;
    if (!TEXT_EXTS.has(file.extension) && file.extension !== "[none]") continue;
    const absolute = path.join(repoPath, file.relativePath);
    try {
      const stat = fs.statSync(absolute);
      if (stat.size > 80_000) continue;
      const text = fs.readFileSync(absolute, "utf8").slice(0, Math.min(12_000, remaining));
      snippets.push({ relativePath: file.relativePath, text: text.trim() });
      remaining -= text.length;
    } catch {
      // Best-effort source pack.
    }
  }
  return snippets;
}

function readPackageJson(repoPath: string): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoPath, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function findManifests(files: ScannedFile[]): string[] {
  const names = new Set([
    "AGENTS.md",
    "CLAUDE.md",
    "Cargo.toml",
    "Dockerfile",
    "Makefile",
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
    "go.mod",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "package.json",
    "pnpm-workspace.yaml",
    "pyproject.toml",
    "requirements.txt",
    "tsconfig.json",
    "vite.config.ts",
  ]);
  return files.filter((file) => names.has(path.basename(file.relativePath))).map((file) => file.relativePath).slice(0, 20);
}

function findDocs(files: ScannedFile[]): string[] {
  return files
    .filter((file) => {
      const base = path.basename(file.relativePath).toLowerCase();
      return base.startsWith("readme") || base === "agents.md" || base === "claude.md" || file.relativePath.startsWith("docs/");
    })
    .map((file) => file.relativePath)
    .slice(0, 24);
}

function detectPackageManager(files: ScannedFile[]): string | null {
  const names = new Set(files.map((file) => path.basename(file.relativePath)));
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("package-lock.json")) return "npm";
  if (names.has("bun.lockb") || names.has("bun.lock")) return "bun";
  if (names.has("package.json")) return "npm";
  return null;
}

function detectPrimaryStack(
  files: ScannedFile[],
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null,
): string[] {
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const names = new Set(files.map((file) => path.basename(file.relativePath)));
  const stack = new Set<string>();
  if (deps.next || names.has("next.config.ts") || names.has("next.config.js")) stack.add("Next.js");
  if (deps.react) stack.add("React");
  if (deps.vite || names.has("vite.config.ts")) stack.add("Vite");
  if (deps.typescript || names.has("tsconfig.json")) stack.add("TypeScript");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) stack.add("Python");
  if (names.has("go.mod")) stack.add("Go");
  if (names.has("Cargo.toml")) stack.add("Rust");
  if (names.has("Dockerfile") || names.has("compose.yaml") || names.has("docker-compose.yml")) stack.add("Docker");
  if (files.some((file) => file.relativePath.startsWith("app/api/") || file.relativePath.includes("/app/api/"))) {
    stack.add("API routes");
  }
  return [...stack].slice(0, 8);
}

function detectKeyDirectories(files: ScannedFile[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const [top] = file.relativePath.split("/");
    if (!top || top === file.relativePath) continue;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([dir]) => dir);
}

function languageCounts(files: ScannedFile[]): { extension: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.extension, (counts.get(file.extension) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([extension, count]) => ({ extension, count }));
}

function detectTestCommands(
  scripts: Record<string, string>,
  packageManager: string | null,
  files: ScannedFile[],
): string[] {
  const commands: string[] = [];
  const runner = packageManager ?? "npm";
  for (const name of ["test", "typecheck", "lint", "verify"]) {
    if (scripts[name]) commands.push(`${runner} run ${name}`);
  }
  if (files.some((file) => file.relativePath.endsWith("_test.go"))) commands.push("go test ./...");
  if (files.some((file) => file.relativePath.endsWith("_test.py") || file.relativePath.startsWith("tests/"))) {
    commands.push("pytest");
  }
  if (files.some((file) => file.relativePath.endsWith(".rs")) && files.some((file) => file.relativePath === "Cargo.toml")) {
    commands.push("cargo test");
  }
  return unique(commands).slice(0, 8);
}

function detectRunCommands(
  scripts: Record<string, string>,
  packageManager: string | null,
  files: ScannedFile[],
): string[] {
  const commands: string[] = [];
  const runner = packageManager ?? "npm";
  for (const name of ["dev", "start", "serve", "preview"]) {
    if (scripts[name]) commands.push(`${runner} run ${name}`);
  }
  if (files.some((file) => path.basename(file.relativePath) === "compose.yaml" || path.basename(file.relativePath) === "docker-compose.yml")) {
    commands.push("docker compose up -d");
  }
  return unique(commands).slice(0, 8);
}

async function getRecentCommits(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "log", "--oneline", "-5"], { timeout: 5_000 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function buildHeadline(primaryStack: string[], keyDirectories: string[], docs: string[], manifests: string[]): string {
  const stack = primaryStack.length ? primaryStack.slice(0, 3).join(", ") : "Unclassified stack";
  const dirs = keyDirectories.length ? `Key dirs: ${keyDirectories.slice(0, 3).join(", ")}.` : "No dominant directories detected.";
  const docSignal = docs.length ? `${docs.length} docs/source files found.` : `${manifests.length} manifests found.`;
  return `${stack}. ${dirs} ${docSignal}`;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
