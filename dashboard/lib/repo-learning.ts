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

export interface RepoLearningProfile {
  repoName: string;
  repoPath: string;
  generatedAt: string;
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
  briefMarkdown: string;
  notebookPackMarkdown: string;
  openCodePrompt: string;
  quiz: RepoQuizQuestion[];
}

export interface RepoQuizQuestion {
  id: string;
  question: string;
  answer: string;
  source: string | null;
}

interface ScannedFile {
  relativePath: string;
  extension: string;
}

interface ReadSnippet {
  relativePath: string;
  text: string;
}

export async function buildRepoLearningProfile(repoPath: string): Promise<RepoLearningProfile> {
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
  const openCodePrompt = buildOpenCodePrompt(repoName);
  const quiz = buildQuiz({
    repoName,
    primaryStack,
    packageManager,
    scripts,
    keyDirectories,
    docs,
    manifests,
    testCommands,
    runCommands,
    recentCommits,
  });
  const briefMarkdown = buildBriefMarkdown({
    repoName,
    repoPath,
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
  });
  const notebookPackMarkdown = buildNotebookPackMarkdown({
    repoName,
    repoPath,
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
    openCodePrompt,
  });

  return {
    repoName,
    repoPath,
    generatedAt: new Date().toISOString(),
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
    briefMarkdown,
    notebookPackMarkdown,
    openCodePrompt,
    quiz,
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

function readUsefulSnippets(repoPath: string, files: ScannedFile[]): ReadSnippet[] {
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

  const snippets: ReadSnippet[] = [];
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
      // Best-effort source pack. Broken files do not make the whole feature useless.
    }
  }
  return snippets;
}

function readPackageJson(repoPath: string): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
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
  if (files.some((file) => file.relativePath.startsWith("app/api/") || file.relativePath.includes("/app/api/"))) stack.add("API routes");
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
  if (files.some((file) => file.relativePath.endsWith("_test.py") || file.relativePath.startsWith("tests/"))) commands.push("pytest");
  if (files.some((file) => file.relativePath.endsWith(".rs")) && files.some((file) => file.relativePath === "Cargo.toml")) commands.push("cargo test");
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

function buildBriefMarkdown(input: Omit<RepoLearningProfile, "generatedAt" | "briefMarkdown" | "notebookPackMarkdown" | "openCodePrompt" | "quiz">): string {
  const lines = [
    `# ${input.repoName} repo brief`,
    "",
    input.headline,
    "",
    "## Stack",
    bulletList(input.primaryStack.length ? input.primaryStack : ["No clear stack detected from manifests."]),
    "",
    "## Run",
    bulletList(input.runCommands.length ? input.runCommands : ["No common run command detected. Check README or manifests."]),
    "",
    "## Verify",
    bulletList(input.testCommands.length ? input.testCommands : ["No common test command detected. Check CI or README."]),
    "",
    "## First files to read",
    bulletList(unique([...input.docs.slice(0, 6), ...input.manifests.slice(0, 6)]).slice(0, 10)),
    "",
    "## Key directories",
    bulletList(input.keyDirectories.length ? input.keyDirectories : ["No nested directories detected."]),
    "",
    "## Recent commits",
    bulletList(input.recentCommits.length ? input.recentCommits : ["No recent commit data available."]),
  ];
  return lines.join("\n");
}

function buildNotebookPackMarkdown(input: Omit<RepoLearningProfile, "generatedAt" | "briefMarkdown" | "notebookPackMarkdown" | "quiz"> & { snippets: ReadSnippet[] }): string {
  const sections = [
    `# NotebookLM pack: ${input.repoName}`,
    "",
    "Paste or upload this file into NotebookLM as a source. It intentionally skips secrets, build output, dependencies, and oversized files.",
    "",
    input.headline,
    "",
    "## Repo facts",
    `- Path: \`${input.repoPath}\``,
    `- Stack: ${input.primaryStack.join(", ") || "Unknown"}`,
    `- Package manager: ${input.packageManager ?? "Unknown"}`,
    `- Key directories: ${input.keyDirectories.join(", ") || "None detected"}`,
    "",
    "## Commands",
    "### Run",
    bulletList(input.runCommands.length ? input.runCommands : ["No common run command detected."]),
    "",
    "### Verify",
    bulletList(input.testCommands.length ? input.testCommands : ["No common test command detected."]),
    "",
    "## Manifests and docs",
    bulletList(unique([...input.docs, ...input.manifests]).slice(0, 40)),
    "",
    "## Language/file signal",
    bulletList(input.languageBreakdown.map((row) => `${row.extension}: ${row.count}`)),
    "",
    "## OpenCode handoff prompt",
    input.openCodePrompt,
    "",
    "## Source excerpts",
  ];

  for (const snippet of input.snippets) {
    sections.push("", `### ${snippet.relativePath}`, "", "```", snippet.text.slice(0, 12_000), "```");
  }

  return sections.join("\n");
}

function buildOpenCodePrompt(repoName: string): string {
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

function buildQuiz(input: {
  repoName: string;
  primaryStack: string[];
  packageManager: string | null;
  scripts: Record<string, string>;
  keyDirectories: string[];
  docs: string[];
  manifests: string[];
  testCommands: string[];
  runCommands: string[];
  recentCommits: string[];
}): RepoQuizQuestion[] {
  return [
    {
      id: "stack",
      question: `What stack signals does ${input.repoName} expose from its manifests?`,
      answer: input.primaryStack.length ? input.primaryStack.join(", ") : "No obvious stack was detected from the scanned manifests.",
      source: firstManifest(input.manifests),
    },
    {
      id: "run",
      question: "Which command would you try first to run it locally?",
      answer: input.runCommands[0] ?? "No common run command was detected; start with README/docs or inspect package/Makefile scripts.",
      source: firstManifest(input.manifests),
    },
    {
      id: "verify",
      question: "How would you verify a change before opening a PR?",
      answer: input.testCommands.length ? input.testCommands.join("; ") : "No common verification command was detected from repo scripts or test files.",
      source: firstManifest(input.manifests),
    },
    {
      id: "reading-path",
      question: "Which files or directories should a new contributor read first?",
      answer: unique([...input.docs.slice(0, 4), ...input.keyDirectories.slice(0, 4)]).join(", ") || "No strong reading path was detected.",
      source: input.docs[0] ?? null,
    },
    {
      id: "change-signal",
      question: "What recent commit theme should you scan before changing this repo?",
      answer: input.recentCommits[0] ?? "No recent commit data was available.",
      source: null,
    },
  ];
}

function firstManifest(manifests: string[]): string | null {
  return manifests.find((file) => file === "package.json") ?? manifests[0] ?? null;
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
