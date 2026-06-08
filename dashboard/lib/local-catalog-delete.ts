/**
 * Remove skill/agent installations from local tool directories (~/.codex, etc.).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanLocalAgentImportCandidates } from "./collect-agents";
import { scanLocalSkillImportCandidates } from "./collect-skills";
import { SKILL_SLUG } from "./skills-shared";

const AGENT_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function assertUnderHome(absPath: string): void {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(absPath);
  if (resolved !== home && !resolved.startsWith(`${home}${path.sep}`)) {
    throw new Error("Refusing to delete path outside home directory");
  }
}

function removeLocalPath(absPath: string, kind: "skill" | "agent"): void {
  assertUnderHome(absPath);
  if (!fs.existsSync(absPath)) return;
  if (kind === "skill") {
    fs.rmSync(absPath, { recursive: true, force: true });
    return;
  }
  fs.rmSync(absPath, { force: true });
}

export interface DeleteLocalInstallationsResult {
  name: string;
  tools: string[];
}

export function deleteLocalSkillInstallations(
  repoRoot: string,
  name: string,
): DeleteLocalInstallationsResult | null {
  if (!SKILL_SLUG.test(name)) return null;
  const candidate = scanLocalSkillImportCandidates(repoRoot).find((c) => c.name === name);
  if (!candidate) return null;
  for (const source of candidate.sources) {
    removeLocalPath(source.absPath, "skill");
  }
  return { name, tools: [...new Set(candidate.sources.map((s) => s.tool))] };
}

export function deleteLocalAgentInstallations(
  repoRoot: string,
  name: string,
): DeleteLocalInstallationsResult | null {
  if (!AGENT_SLUG.test(name)) return null;
  const candidate = scanLocalAgentImportCandidates(repoRoot).find((c) => c.name === name);
  if (!candidate) return null;
  for (const source of candidate.sources) {
    removeLocalPath(source.absPath, "agent");
  }
  return { name, tools: [...new Set(candidate.sources.map((s) => s.tool))] };
}
