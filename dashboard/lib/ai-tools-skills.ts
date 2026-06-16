/**
 * Read-only integration with the businessinsider/ai-tools checkout.
 * Skills stay canonical in that repo; DevHub syncs from a local clone path.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitShortHead } from "./git-repo-local";
import { listSkillDirNames, resolveSkillDirUnder } from "./skills-shared";
import { refreshUpstreamSkills } from "./upstream-skills-refresh";
import {
  resolveCachedSkillsDir,
  upstreamSkillsCommit,
} from "./upstream-skills-cache";

const SKILLS_SUBDIR = "skills";
const BI_SKILL_PREFIX = "bi-";

export interface RefreshAiToolsResult {
  ok: boolean;
  warning?: string;
  commit?: string;
  pulled?: boolean;
}

function isEnvFlagDisabled(name: string): boolean {
  const flag = process.env[name]?.trim().toLowerCase();
  return flag === "0" || flag === "false" || flag === "no";
}

export function isAiToolsSyncEnabled(): boolean {
  return !isEnvFlagDisabled("AI_TOOLS_SYNC");
}

/** When false, sync skips upstream skills fetch (offline-friendly). Default true. */
export function isAiToolsRefreshOnSyncEnabled(): boolean {
  return !isEnvFlagDisabled("AI_TOOLS_REFRESH_ON_SYNC");
}

export function resolveAiToolsRoot(): string {
  const override = process.env.AI_TOOLS_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), "Developer", "ai-tools");
}

function checkoutSkillsDir(root: string): string {
  return path.join(root, SKILLS_SUBDIR);
}

/** Prefer cached upstream skills after refresh; fall back to the local checkout tree. */
export function aiToolsSkillsDir(root?: string): string {
  const checkoutRoot = root ?? resolveAiToolsRoot();
  return resolveCachedSkillsDir(checkoutRoot) ?? checkoutSkillsDir(checkoutRoot);
}

export function isAiToolsAvailable(): boolean {
  if (!isAiToolsSyncEnabled()) return false;
  const skillsDir = aiToolsSkillsDir();
  return fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory();
}

export function listAiToolsSkillNames(root?: string): string[] {
  return listSkillDirNames(aiToolsSkillsDir(root)).map(aiToolsSkillCatalogName);
}

export function resolveAiToolsSkillDir(name: string, root?: string): string | null {
  const skillsDir = aiToolsSkillsDir(root);
  const exact = resolveSkillDirUnder(skillsDir, name);
  if (exact) return exact;
  if (!name.startsWith(BI_SKILL_PREFIX)) return null;
  return resolveSkillDirUnder(skillsDir, name.slice(BI_SKILL_PREFIX.length));
}

export function aiToolsSkillCatalogName(sourceName: string): string {
  return sourceName.startsWith(BI_SKILL_PREFIX) ? sourceName : `${BI_SKILL_PREFIX}${sourceName}`;
}

export function rewriteAiToolsSkillFrontmatterName(content: string, catalogName: string): string {
  const frontmatter = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n|$)/);
  if (!frontmatter) {
    return `---\nname: ${catalogName}\n---\n\n${content}`;
  }

  const eol = frontmatter[1].includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatter[2].split(/\r?\n/);
  const nameIndex = lines.findIndex((line) => /^name:\s*/.test(line));
  if (nameIndex >= 0) {
    lines[nameIndex] = `name: ${catalogName}`;
  } else {
    lines.unshift(`name: ${catalogName}`);
  }

  return `${frontmatter[1]}${lines.join(eol)}${frontmatter[3]}${frontmatter[4]}${content.slice(frontmatter[0].length)}`;
}

function displayCommit(root: string): string | undefined {
  return upstreamSkillsCommit(root) ?? gitShortHead(root);
}

export async function refreshAiToolsRepo(opts: {
  emit: (line: string) => void;
  dryRun?: boolean;
  root?: string;
  /** When false, skip git operations (caller already checked policy). */
  allowGit?: boolean;
}): Promise<RefreshAiToolsResult> {
  const { emit } = opts;
  const root = opts.root ?? resolveAiToolsRoot();

  if (opts.allowGit === false) {
    return { ok: true, commit: displayCommit(root) };
  }
  if (!isAiToolsSyncEnabled()) {
    emit("ai-tools sync disabled (AI_TOOLS_SYNC=0).");
    return { ok: true, warning: "disabled" };
  }

  if (!fs.existsSync(root)) {
    const msg = `ai-tools not found at ${root} — set AI_TOOLS_ROOT or clone businessinsider/ai-tools`;
    emit(`WARNING: ${msg}`);
    return { ok: false, warning: msg };
  }

  if (!fs.existsSync(path.join(root, ".git"))) {
    const msg = `ai-tools path is not a git repo: ${root}`;
    emit(`WARNING: ${msg}`);
    return { ok: false, warning: msg };
  }

  if (opts.dryRun) {
    emit(`[DRY-RUN] Would fetch upstream skills for ${root} (default branch → cache)`);
    return { ok: true, commit: displayCommit(root) };
  }

  emit(`Refreshing ai-tools skills from upstream (leaving your checkout untouched)...`);
  const refresh = await refreshUpstreamSkills({ checkoutRoot: root });
  if (!refresh.ok) {
    const msg = refresh.warning ?? "upstream skills refresh failed";
    emit(`WARNING: ai-tools refresh failed — using local checkout (${msg})`);
    return { ok: false, warning: msg, commit: displayCommit(root), pulled: false };
  }

  const label = refresh.repo && refresh.branch ? `${refresh.repo}@${refresh.branch}` : "upstream";
  emit(`ai-tools skills updated from ${label} (${refresh.commit ?? "unknown commit"}).`);
  return { ok: true, commit: refresh.commit, pulled: true };
}

/** API-friendly wrapper (no streaming log required). */
export async function refreshAiToolsForApi(
  opts?: { dryRun?: boolean },
): Promise<RefreshAiToolsResult & { lines: string[] }> {
  const lines: string[] = [];
  const result = await refreshAiToolsRepo({
    dryRun: opts?.dryRun,
    emit: (line) => lines.push(line),
  });
  return { ...result, lines };
}
